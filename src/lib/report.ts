// Builds the content-free diagnostics report, and (optionally) sends it to the
// reporting endpoint so problems can be diagnosed and fixed remotely.
import { db, getMeta } from "./db";
import { lastBackupAt } from "./backup";
import { runHealthChecks } from "./health";
import { getSettings } from "./settings";
import { APP, SESSION, errorsByArea, getMetricSummaries, getRecent, info, onErrorLogged, persistMetrics, warn } from "./telemetry";
import { redactNames, type DiagReport } from "./telemetry-core";

const DEFAULT_ENDPOINT = "/.netlify/functions/diag";
const LS_BACKOFF = "pipit-notes.report.backoffUntil";
const LS_LAST_SENT = "pipit-notes.report.lastSent";
const LS_LAST_SESSION = "pipit-notes.report.lastSession";

export async function buildReport(trigger?: string): Promise<DiagReport> {
  await persistMetrics();
  const d = await db();
  const [notes, notebooks, blocks, pageTexts, versions, diagEntries] = await Promise.all([
    d.getAll("notes"), d.count("notebooks"), d.count("blocks"), d.count("pageText"), d.count("versions"), d.count("diag"),
  ]);
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; rtt?: number; downlink?: number; saveData?: boolean }; standalone?: boolean };
  let persisted: boolean | null = null;
  let usage: number | undefined;
  let quota: number | undefined;
  try {
    persisted = nav.storage?.persisted ? await nav.storage.persisted() : null;
    const est = await nav.storage?.estimate?.();
    usage = est?.usage; quota = est?.quota;
  } catch { /* ignore */ }
  const s = getSettings();
  const recent = await getRecent(160);
  // problems first, then the most recent info, capped so the report stays small
  const problems = recent.filter((e) => e.level !== "info").slice(0, 100);
  const infos = recent.filter((e) => e.level === "info").slice(0, 40);
  const install = await getMeta<{ createdAt: number }>("install");

  const names = [...notes.map((n) => n.title), ...(await d.getAll("notebooks")).map((b) => b.name)];

  const report: DiagReport = {
    format: "pipit-notes-diagnostics",
    version: 1,
    generatedAt: Date.now(),
    app: { ...APP },
    session: SESSION,
    trigger,
    env: {
      ua: navigator.userAgent,
      platform: navigator.platform,
      lang: navigator.language,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dpr: window.devicePixelRatio,
      screen: { w: screen.width, h: screen.height },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      online: navigator.onLine,
      standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
      cores: navigator.hardwareConcurrency ?? null,
      memoryGB: nav.deviceMemory ?? null,
      touchPoints: navigator.maxTouchPoints ?? null,
      connection: nav.connection ? { type: nav.connection.effectiveType, rtt: nav.connection.rtt, downlink: nav.connection.downlink, saveData: nav.connection.saveData } : null,
    },
    storage: { persisted, usage, quota },
    counts: {
      notes: notes.length,
      notebooks,
      strokes: notes.reduce((a, n) => a + n.strokeCount, 0),
      images: notes.reduce((a, n) => a + n.imageCount, 0),
      pages: notes.reduce((a, n) => a + n.pageCount, 0),
      blocks,
      pageTexts,
      versions,
      logEntries: diagEntries,
    },
    settings: {
      aiEnabled: s.aiEnabled, hasKey: s.apiKey.trim().length > 0, model: s.model, autoIndex: s.autoIndex, shapeSnap: s.shapeSnap,
      theme: s.theme, diagnostics: s.diagnostics, reportEnabled: s.reportEnabled,
    },
    health: await runHealthChecks(),
    metrics: await getMetricSummaries(),
    errorsByArea: await errorsByArea(),
    recent: [...problems, ...infos].sort((a, b) => b.t - a.t).map(({ t, session, level, area, msg, data }) => ({ t, session, level, area, msg, data })),
    lastBackupAt: await lastBackupAt(),
    firstSeenAt: install?.createdAt ?? null,
  };
  // Belt and braces: no note title or notebook name may appear anywhere in a report.
  return redactNames(report, names);
}

// --- remote reporting ----------------------------------------------------------------------------------

const num = (k: string): number => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
const setNum = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* ignore */ } };

export type SendResult = { ok: boolean; status?: number; skipped?: string };

/** Send a report to the endpoint. Never throws; backs off for hours after a failure so it can't spam. */
export async function sendReport(trigger: string, force = false): Promise<SendResult> {
  const s = getSettings();
  if (!force && (!s.reportEnabled || !s.diagnostics)) return { ok: false, skipped: "reporting is off" };
  if (!force && Date.now() < num(LS_BACKOFF)) return { ok: false, skipped: "backing off after an earlier failure" };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, skipped: "offline" };
  try {
    const report = await buildReport(trigger);
    // keep the payload well under typical limits: trim the log tail if needed
    let body = JSON.stringify(report);
    while (body.length > 150_000 && report.recent.length > 10) { report.recent = report.recent.slice(0, Math.floor(report.recent.length / 2)); body = JSON.stringify(report); }
    const res = await fetch(s.reportUrl.trim() || DEFAULT_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: body.length < 60_000 });
    if (!res.ok) {
      setNum(LS_BACKOFF, Date.now() + (res.status === 404 || res.status === 405 ? 24 : 3) * 3600_000);
      if (res.status !== 404 && res.status !== 405) warn("report", "report endpoint rejected the report", { status: res.status });
      return { ok: false, status: res.status };
    }
    setNum(LS_LAST_SENT, Date.now());
    setNum(LS_BACKOFF, 0);
    return { ok: true, status: res.status };
  } catch (e) {
    setNum(LS_BACKOFF, Date.now() + 3 * 3600_000);
    return { ok: false, skipped: String((e as Error)?.message ?? e).slice(0, 80) };
  }
}

let started = false;
/** Wire up automatic reporting: on errors (rate-limited), once per session, and when the app is hidden. */
export function startReporter(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  let errTimer: ReturnType<typeof setTimeout> | null = null;
  onErrorLogged(() => {
    if (errTimer || Date.now() - num(LS_LAST_SENT) < 10 * 60_000) return; // at most one error report / 10 min
    errTimer = setTimeout(() => { errTimer = null; void sendReport("error"); }, 15_000);
  });

  // one health snapshot per ~6h, shortly after launch (lets problems be spotted even without errors)
  setTimeout(() => {
    if (Date.now() - num(LS_LAST_SESSION) > 6 * 3600_000) { setNum(LS_LAST_SESSION, Date.now()); void sendReport("session"); }
  }, 25_000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    if (Date.now() - num(LS_LAST_SENT) < 30 * 60_000) return;
    void sendReport("hidden");
  });
  info("report", "reporter ready");
}
