// Local, content-free diagnostics: an event log (ring-buffered in IndexedDB) plus
// running metric aggregates. Everything here is best-effort — monitoring must NEVER
// be the thing that breaks the app — and nothing leaves the device unless the user
// shares a report or reporting is enabled (see report.ts).
import { db, getMeta, setDbEventHandler, setMeta } from "./db";
import { newId } from "./ids";
import { getSettings } from "./settings";
import {
  addSample, describeError, InputAggregator, scrub, scrubString, summarizeMetric,
  type MetricAgg, type MetricSummary,
} from "./telemetry-core";
import type { LogEntry, LogLevel } from "@/types";

export const APP = {
  version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev",
  build: typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "dev",
  commit: typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : "dev",
};
export const SESSION = newId().slice(0, 8);
const STARTED = Date.now();

const MAX_ENTRIES = 3000;
const PRUNE_TO = 2200;
const METRICS_KEY = "metrics:v1";

// --- event log ---------------------------------------------------------------------------

let queue: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const errorListeners = new Set<(e: LogEntry) => void>();

/** Subscribe to error events (used by the reporter). Returns an unsubscribe fn. */
export function onErrorLogged(fn: (e: LogEntry) => void): () => void {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}

export function log(level: LogLevel, area: string, msg: string, data?: unknown): void {
  try {
    const entry: LogEntry = {
      t: Date.now(), session: SESSION, level, area: scrubString(area).slice(0, 40), msg: scrubString(msg),
      data: data === undefined ? undefined : (scrub(data) as Record<string, unknown>),
    };
    (level === "error" ? console.error : level === "warn" ? console.warn : console.info)(`[${area}] ${entry.msg}`, entry.data ?? "");
    if (!getSettings().diagnostics) return;
    queue.push(entry);
    if (queue.length > 500) queue = queue.slice(-500); // never grow unbounded if the DB is unavailable
    scheduleFlush();
    if (level === "error") errorListeners.forEach((fn) => { try { fn(entry); } catch { /* listener bugs must not break logging */ } });
  } catch {
    /* swallow: logging can't throw */
  }
}
export const info = (area: string, msg: string, data?: unknown) => log("info", area, msg, data);
export const warn = (area: string, msg: string, data?: unknown) => log("warn", area, msg, data);
export const error = (area: string, msg: string, data?: unknown) => log("error", area, msg, data);

/** Log a caught error with a stable, scrubbed description. */
export function logError(area: string, e: unknown, extra?: Record<string, unknown>): void {
  const d = describeError(e);
  log("error", area, `${d.name}: ${d.message}`, { ...extra, where: d.where });
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; void flushLog(); }, 1500);
}

export async function flushLog(): Promise<void> {
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  try {
    const d = await db();
    const tx = d.transaction("diag", "readwrite");
    for (const e of batch) tx.store.add(e);
    await tx.done;
    const n = await d.count("diag");
    if (n > MAX_ENTRIES) {
      const tx2 = d.transaction("diag", "readwrite");
      let drop = n - PRUNE_TO;
      let cur = await tx2.store.openCursor();
      while (cur && drop-- > 0) { await cur.delete(); cur = await cur.continue(); }
      await tx2.done;
    }
  } catch {
    queue = [...batch.slice(-200), ...queue]; // keep a little for the next attempt; never throw
  }
}

export async function getRecent(limit = 150, onlyProblems = false): Promise<LogEntry[]> {
  await flushLog();
  const all = await (await db()).getAll("diag");
  const rows = onlyProblems ? all.filter((e) => e.level !== "info") : all;
  return rows.slice(-limit).reverse();
}
export async function clearLog(): Promise<void> {
  queue = [];
  await (await db()).clear("diag");
}
export async function errorCountSince(ms: number, area?: string): Promise<number> {
  await flushLog();
  const since = Date.now() - ms;
  const all = await (await db()).getAll("diag");
  return all.filter((e) => e.level === "error" && e.t >= since && (!area || e.area === area)).length;
}
export async function errorsByArea(): Promise<Record<string, number>> {
  await flushLog();
  const out: Record<string, number> = {};
  for (const e of await (await db()).getAll("diag")) if (e.level === "error") out[e.area] = (out[e.area] ?? 0) + 1;
  return out;
}

// --- metrics -----------------------------------------------------------------------------------

let metrics: Record<string, MetricAgg> | null = null;
let metricsLoading: Promise<void> | null = null;
let pendingSamples: [string, number][] = [];
let metricsTimer: ReturnType<typeof setTimeout> | null = null;

async function loadMetrics(): Promise<void> {
  if (metrics) return;
  if (!metricsLoading) {
    metricsLoading = (async () => {
      try { metrics = (await getMeta<Record<string, MetricAgg>>(METRICS_KEY)) ?? {}; } catch { metrics = {}; }
      for (const [k, v] of pendingSamples) metrics[k] = addSample(metrics[k], v);
      pendingSamples = [];
    })();
  }
  await metricsLoading;
}

/** Record one numeric sample (a duration, a count, a rate…). */
export function track(key: string, value: number): void {
  if (!getSettings().diagnostics || !Number.isFinite(value)) return;
  if (metrics) metrics[key] = addSample(metrics[key], value);
  else { pendingSamples.push([key, value]); if (pendingSamples.length > 300) pendingSamples.shift(); void loadMetrics(); }
  if (!metricsTimer) metricsTimer = setTimeout(() => { metricsTimer = null; void persistMetrics(); }, 5000);
}
/** Count a usage event (a feature being used). */
export const count = (name: string) => track(`usage.${name}`, 1);

export async function persistMetrics(): Promise<void> {
  try { await loadMetrics(); await setMeta(METRICS_KEY, metrics); } catch { /* best effort */ }
}
export async function getMetricSummaries(): Promise<Record<string, MetricSummary>> {
  await loadMetrics();
  const out: Record<string, MetricSummary> = {};
  for (const [k, m] of Object.entries(metrics ?? {})) out[k] = summarizeMetric(m);
  return out;
}
export async function resetMetrics(): Promise<void> {
  metrics = {}; pendingSamples = [];
  await setMeta(METRICS_KEY, {});
}

/** Time something. Call the returned function when done; it records `<key>` in ms and returns it. */
export function timer(key: string): () => number {
  const t0 = performance.now();
  return () => { const ms = performance.now() - t0; track(key, ms); return ms; };
}

// --- pen-input quality -------------------------------------------------------------------------------

const inputAgg = new InputAggregator(300);
/** Feed canvas pen samples in; once per ~300 moves it records input QUALITY metrics (not strokes). */
export function recordInputSample(s: { phase: string; dt: number; coalesced: number; pressure: number; handlerMs: number; ptr: string }): void {
  const w = inputAgg.add(s);
  if (!w) return;
  track("input.hz", w.hz);
  track("input.coalescedMean", w.coalescedMean);
  track("input.gaps64Pct", w.gaps64Pct);
  track("input.maxGapMs", w.maxGapMs);
  track("input.handlerP95Ms", w.handlerP95Ms);
  track("input.pressureDistinct", w.pressureDistinct);
  if (w.gaps64Pct > 8 || w.maxGapMs > 400) warn("input", "pen input stalled while writing", { hz: Math.round(w.hz), gaps64Pct: Math.round(w.gaps64Pct), maxGapMs: Math.round(w.maxGapMs), pointer: w.pointer });
}

// --- global handlers ---------------------------------------------------------------------------------------

let installed = false;
export function installGlobalHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  setDbEventHandler((e) => log(e.level, "db", e.msg, e.data));

  window.addEventListener("error", (ev) => {
    // Resource-load errors (img/script) bubble here without a message; ignore the noise.
    if (!ev.message && !ev.error) return;
    const d = describeError(ev.error ?? ev.message);
    log("error", "runtime", `${d.name}: ${d.message}`, { where: d.where ?? `${String(ev.filename ?? "").replace(/^https?:\/\/[^/]+/, "")}:${ev.lineno}` });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const d = describeError(ev.reason);
    log("error", "promise", `${d.name}: ${d.message}`, { where: d.where });
  });
  window.addEventListener("online", () => info("net", "back online"));
  window.addEventListener("offline", () => warn("net", "went offline"));
  const hide = () => {
    if (document.visibilityState === "hidden") {
      track("session.activeMin", (Date.now() - STARTED) / 60000);
      void flushLog();
      void persistMetrics();
    }
  };
  document.addEventListener("visibilitychange", hide);
  window.addEventListener("pagehide", () => { void flushLog(); void persistMetrics(); });
  info("app", "started", { version: APP.version, commit: APP.commit });
}

export const sessionAgeMs = () => Date.now() - STARTED;
