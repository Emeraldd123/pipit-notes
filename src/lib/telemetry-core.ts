// Pure monitoring logic (no DOM / IndexedDB) so it can be unit-tested in Node and
// shared with tools/diag-report.mjs. The golden rule: diagnostics are CONTENT-FREE.
// They describe how the app behaved (counts, timings, errors, device) — never what
// you wrote, never note titles, never credentials.

// --- scrubbing ----------------------------------------------------------------------

/** Keys whose values are dropped outright, wherever they appear. */
const DENY_KEYS = /^(api.?key|key|token|authorization|secret|password|passwd|text|title|name|content|code|prompt|image|images|dataurl|data|body|html|latex|output|formula|formulas|sympy|question|answer)$/i;
const KEY_PATTERNS: RegExp[] = [/sk-ant-[A-Za-z0-9_\-]{6,}/g, /sk-[A-Za-z0-9]{20,}/g, /Bearer\s+[A-Za-z0-9._\-]{10,}/g, /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{20,}/g];
const MAX_STR = 300;

export function scrubString(s: string): string {
  let out = s;
  for (const re of KEY_PATTERNS) out = out.replace(re, "[redacted]");
  return out.length > MAX_STR ? out.slice(0, MAX_STR) + "…" : out;
}

export function scrub(v: unknown, depth = 0): unknown {
  if (v == null) return v;
  if (typeof v === "string") return scrubString(v);
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
  if (typeof v === "boolean") return v;
  if (typeof v === "bigint") return Number(v);
  if (depth >= 3) return "[deep]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  if (v instanceof Error) return { name: v.name, message: scrubString(v.message) };
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 30)) {
      if (DENY_KEYS.test(k)) continue;
      out[k] = scrub(val, depth + 1);
    }
    return out;
  }
  return undefined; // functions, symbols
}

/**
 * Replace every occurrence of any known private name (note titles, notebook names) in
 * all strings of a value. The generic scrubber can't know what your titles are, so
 * reports are additionally redacted against the names that actually exist.
 */
export function redactNames<T>(value: T, names: string[]): T {
  const clean = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length);
  if (!clean.length) return value;
  const re = new RegExp(clean.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(re, "[name]");
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** A short, stable description of an error for grouping (no stack paths with user data). */
export function describeError(e: unknown): { name: string; message: string; where?: string } {
  const err = e as { name?: string; message?: string; stack?: string } | null;
  const message = scrubString(String(err?.message ?? e ?? "unknown error"));
  const name = String(err?.name ?? "Error");
  const frame = (err?.stack ?? "").split("\n").map((l) => l.trim()).find((l) => /\.(tsx?|jsx?|mjs)[:?]/.test(l) || /assets\/[^/]+\.js/.test(l));
  const where = frame ? scrubString(frame.replace(/^at\s+/, "").replace(/https?:\/\/[^/]+/, "")) : undefined;
  return { name, message, where };
}

// --- metrics ----------------------------------------------------------------------------

export type MetricAgg = { n: number; sum: number; min: number; max: number; last: number; recent: number[] };

export function addSample(m: MetricAgg | undefined, v: number, keep = 200): MetricAgg {
  if (!Number.isFinite(v)) return m ?? { n: 0, sum: 0, min: 0, max: 0, last: 0, recent: [] };
  const base = m ?? { n: 0, sum: 0, min: v, max: v, last: v, recent: [] };
  const recent = base.recent.length >= keep ? [...base.recent.slice(base.recent.length - keep + 1), v] : [...base.recent, v];
  return { n: base.n + 1, sum: base.sum + v, min: Math.min(base.min, v), max: Math.max(base.max, v), last: v, recent };
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

export type MetricSummary = { n: number; mean: number; p95: number; max: number; min: number; last: number };
export const summarizeMetric = (m: MetricAgg): MetricSummary => ({
  n: m.n, mean: m.n ? m.sum / m.n : 0, p95: percentile(m.recent, 0.95), max: m.max, min: m.min, last: m.last,
});

// --- input-quality aggregation -------------------------------------------------------------

export type InputWindow = {
  moves: number;
  hz: number;
  coalescedMean: number;
  gaps32Pct: number;
  gaps64Pct: number;
  maxGapMs: number;
  handlerP95Ms: number;
  handlerMaxMs: number;
  pressureDistinct: number;
  pointer: string;
};

/** Rolls pen-event samples up into one summary per ~WINDOW moves, so we record input QUALITY, not strokes. */
export class InputAggregator {
  private dts: number[] = [];
  private coal: number[] = [];
  private handler: number[] = [];
  private pressures = new Set<string>();
  private pointer = "";
  private window: number;
  constructor(window = 300) { this.window = window; }
  add(s: { phase: string; dt: number; coalesced: number; pressure: number; handlerMs: number; ptr: string }): InputWindow | null {
    if (s.phase !== "move") return null;
    this.pointer = s.ptr;
    if (s.dt > 0 && s.dt < 1500) this.dts.push(s.dt);
    this.coal.push(Math.max(1, s.coalesced));
    this.handler.push(s.handlerMs);
    this.pressures.add(s.pressure.toFixed(2));
    if (this.coal.length < this.window) return null;
    return this.flush();
  }
  flush(): InputWindow | null {
    if (this.coal.length < 20) return null;
    const mean = this.dts.length ? this.dts.reduce((a, b) => a + b, 0) / this.dts.length : 0;
    const out: InputWindow = {
      moves: this.coal.length,
      hz: mean ? 1000 / mean : 0,
      coalescedMean: this.coal.reduce((a, b) => a + b, 0) / this.coal.length,
      gaps32Pct: this.dts.length ? (100 * this.dts.filter((d) => d > 32).length) / this.dts.length : 0,
      gaps64Pct: this.dts.length ? (100 * this.dts.filter((d) => d > 64).length) / this.dts.length : 0,
      maxGapMs: this.dts.length ? Math.max(...this.dts) : 0,
      handlerP95Ms: percentile(this.handler, 0.95),
      handlerMaxMs: this.handler.length ? Math.max(...this.handler) : 0,
      pressureDistinct: this.pressures.size,
      pointer: this.pointer,
    };
    this.dts = []; this.coal = []; this.handler = []; this.pressures = new Set();
    return out;
  }
}

// --- the report -------------------------------------------------------------------------------

export type HealthItem = { id: string; label: string; status: "ok" | "warn" | "bad" | "info"; detail: string };

export type DiagReport = {
  format: "pipit-notes-diagnostics";
  version: 1;
  generatedAt: number;
  app: { version: string; build: string; commit: string };
  session: string;
  trigger?: string;
  env: Record<string, unknown>;
  storage: { persisted: boolean | null; usage?: number; quota?: number };
  counts: Record<string, number>;
  settings: Record<string, unknown>;
  health: HealthItem[];
  metrics: Record<string, MetricSummary>;
  errorsByArea: Record<string, number>;
  recent: { t: number; session: string; level: string; area: string; msg: string; data?: Record<string, unknown> }[];
  lastBackupAt: number | null;
  firstSeenAt: number | null;
};

// Thresholds that turn raw numbers into "something's wrong" flags.
export const THRESHOLDS: { key: string; test: (m: MetricSummary) => boolean; text: (m: MetricSummary) => string }[] = [
  { key: "save.ms", test: (m) => m.p95 > 600, text: (m) => `Local saves are slow (p95 ${m.p95.toFixed(0)} ms, max ${m.max.toFixed(0)} ms) — storage under pressure or a very large note.` },
  { key: "open.ms", test: (m) => m.p95 > 3000, text: (m) => `Opening notes is slow (p95 ${m.p95.toFixed(0)} ms) — check the largest notes (stroke counts in the log).` },
  { key: "input.hz", test: (m) => m.n > 0 && m.mean < 40, text: (m) => `Pen events arrive at only ~${m.mean.toFixed(0)} Hz — fast strokes will be sparse.` },
  { key: "input.gaps64Pct", test: (m) => m.mean > 3, text: (m) => `${m.mean.toFixed(1)}% of pen events are delayed >64 ms — the main thread is stalling while writing.` },
  { key: "input.handlerP95Ms", test: (m) => m.mean > 4, text: (m) => `Pen handler takes ~${m.mean.toFixed(1)} ms per event (p95) — canvas work is too heavy on this device.` },
  { key: "backup.ms", test: (m) => m.p95 > 20000, text: (m) => `Backups take ${(m.p95 / 1000).toFixed(0)} s — the library is getting large.` },
  { key: "pdf.import.ms", test: (m) => m.p95 > 30000, text: (m) => `PDF imports are slow (p95 ${(m.p95 / 1000).toFixed(0)} s).` },
  { key: "python.load.ms", test: (m) => m.max > 60000, text: (m) => `Python took ${(m.max / 1000).toFixed(0)} s to load — network trouble reaching the runtime CDN?` },
  { key: "ai.ms", test: (m) => m.p95 > 30000, text: (m) => `AI calls are slow (p95 ${(m.p95 / 1000).toFixed(0)} s).` },
];

const fmtAge = (ms: number) => { const m = Math.round(ms / 60000); if (m < 90) return `${m} min`; const h = Math.round(m / 60); return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`; };

/** Turn a report into plain-language findings, worst first. Used by the CLI and the in-app view. */
export function summarizeReport(r: DiagReport, now = Date.now()): { severity: "ok" | "warn" | "bad"; findings: string[]; lines: string[] } {
  const findings: string[] = [];
  let bad = false;
  const lines: string[] = [];
  const env = r.env as { ua?: string; standalone?: boolean; dpr?: number; online?: boolean };
  lines.push(`Report ${new Date(r.generatedAt).toISOString()} · app ${r.app.version} (${r.app.commit}) · session ${r.session}${r.trigger ? ` · trigger: ${r.trigger}` : ""}`);
  lines.push(`Device: ${String(env.ua ?? "?").slice(0, 100)} · dpr ${env.dpr ?? "?"} · ${env.standalone ? "installed" : "in browser tab"}`);
  lines.push(`Library: ${Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  if (r.storage.usage != null) lines.push(`Storage: ${(r.storage.usage / 1048576).toFixed(0)} MB used${r.storage.quota ? ` of ~${(r.storage.quota / 1048576).toFixed(0)} MB` : ""} · persisted: ${r.storage.persisted}`);

  for (const h of r.health) {
    if (h.status === "bad") { bad = true; findings.push(`✗ ${h.label}: ${h.detail}`); }
    else if (h.status === "warn") findings.push(`⚠ ${h.label}: ${h.detail}`);
  }
  const errs = Object.entries(r.errorsByArea).sort((a, b) => b[1] - a[1]);
  if (errs.length) {
    findings.push(`⚠ Errors logged: ${errs.map(([a, n]) => `${a}×${n}`).join(", ")}`);
    const grouped = new Map<string, { n: number; last: number; area: string }>();
    for (const e of r.recent.filter((x) => x.level === "error")) {
      const k = `${e.area}: ${e.msg}`;
      const g = grouped.get(k) ?? { n: 0, last: 0, area: e.area };
      g.n++; g.last = Math.max(g.last, e.t); grouped.set(k, g);
    }
    for (const [k, g] of [...grouped.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) lines.push(`  error ×${g.n} (last ${fmtAge(now - g.last)} ago): ${k}`);
  }
  for (const th of THRESHOLDS) { const m = r.metrics[th.key]; if (m && th.test(m)) findings.push(`⚠ ${th.text(m)}`); }
  if (r.metrics["input.pressureDistinct"] && r.metrics["input.pressureDistinct"].max <= 2) findings.push("ℹ Stylus reports flat pressure (pressure-less stylus, or pressure isn't reaching the browser).");
  if (r.metrics["input.coalescedMean"] && r.metrics["input.coalescedMean"].mean < 1.2) findings.push("ℹ No coalesced pen samples — fast strokes are limited by the stylus/browser rate.");

  const rows = Object.entries(r.metrics).filter(([k]) => !k.startsWith("usage.")).sort();
  if (rows.length) {
    lines.push("Metrics:");
    for (const [k, m] of rows) lines.push(`  ${k.padEnd(26)} n=${String(m.n).padStart(5)}  mean ${m.mean.toFixed(1).padStart(8)}  p95 ${m.p95.toFixed(1).padStart(8)}  max ${m.max.toFixed(1).padStart(8)}`);
  }
  // the student told us an AI answer was wrong (bad exam question, Explain retried, review false alarm, card removed)
  const reports = Object.entries(r.metrics).filter(([k]) => k.startsWith("usage.report.") || k === "usage.study.card.flagged");
  if (reports.length) findings.push(`ℹ AI output reported as wrong: ${reports.map(([k, m]) => `${k.replace("usage.report.", "").replace("usage.", "")}×${m.n}`).join(", ")}`);
  const usage = Object.entries(r.metrics).filter(([k]) => k.startsWith("usage.")).sort((a, b) => b[1].n - a[1].n);
  if (usage.length) lines.push("Usage: " + usage.map(([k, m]) => `${k.slice(6)}×${m.n}`).join(", "));

  const severity = bad ? "bad" : findings.some((f) => f.startsWith("⚠")) ? "warn" : "ok";
  return { severity, findings, lines };
}
