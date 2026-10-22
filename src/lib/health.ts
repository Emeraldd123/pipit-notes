// Health checks and data-loss tripwires. The two scariest failures for a local-first
// app are (1) the browser silently clearing its storage and (2) a session ending with
// edits that never reached disk. Both are detected here and surfaced loudly.
import { db, getMeta, setMeta } from "./db";
import { lastBackupAt } from "./backup";
import { newId } from "./ids";
import { getSettings } from "./settings";
import { error, errorCountSince, info, warn } from "./telemetry";
import type { HealthItem } from "./telemetry-core";

const LS_INSTALL = "pipit-notes.install";
const LS_SENTINEL = "pipit-notes.sentinel";
const LS_DIRTY = "pipit-notes.dirty";

type Install = { id: string; createdAt: number };
const readLS = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const writeLS = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
const delLS = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

// --- unsaved-edits tripwire -------------------------------------------------------------------------------

/** Call when edits are waiting to be written; clear once they're safely on disk. */
export function markDirty(noteId: string): void { if (!localStorage.getItem(LS_DIRTY)) writeLS(LS_DIRTY, { noteId, t: Date.now() }); }
export function clearDirty(): void { delLS(LS_DIRTY); }

// --- library-size sentinel (detects wiped storage) -------------------------------------------------------------

/** Keep a copy of "how many notes should exist" outside IndexedDB. */
export function updateSentinel(notes: number): void { writeLS(LS_SENTINEL, { notes, at: Date.now() }); }

export type BootResult = {
  firstRun: boolean;
  /** IndexedDB was empty/new while localStorage proves the app had data before */
  evicted: boolean;
  notesBefore: number | null;
  /** the previous session ended with edits that may not have been saved */
  uncleanExit: { ageMs: number } | null;
  localStorageCleared: boolean;
};
let boot: BootResult = { firstRun: false, evicted: false, notesBefore: null, uncleanExit: null, localStorageCleared: false };
export const getBootResult = () => boot;

let bootPromise: Promise<BootResult> | null = null;
/** Resolves when the startup checks are done (starting them if needed). Safe to call from the UI. */
export function whenBooted(): Promise<BootResult> {
  return bootChecks();
}

/** Run once at startup. Idempotent: later calls return the same in-flight/finished promise. */
export function bootChecks(): Promise<BootResult> {
  if (!bootPromise) bootPromise = runBootChecks();
  return bootPromise;
}

async function runBootChecks(): Promise<BootResult> {
  const result: BootResult = { firstRun: false, evicted: false, notesBefore: null, uncleanExit: null, localStorageCleared: false };
  try {
    const d = await db();
    const lsInstall = readLS<Install>(LS_INSTALL);
    const idbInstall = (await getMeta<Install>("install")) ?? null;
    const sentinel = readLS<{ notes: number; at: number }>(LS_SENTINEL);
    const noteCount = await d.count("notes");

    if (!lsInstall && !idbInstall) {
      result.firstRun = true;
      const inst: Install = { id: newId(), createdAt: Date.now() };
      await setMeta("install", inst); writeLS(LS_INSTALL, inst);
      info("boot", "first run on this device");
    } else if (!idbInstall && lsInstall) {
      // localStorage survived but the database is brand new: the browser cleared our IndexedDB.
      result.evicted = true;
      result.notesBefore = sentinel?.notes ?? null;
      error("storage", "IndexedDB was cleared by the browser", { notesBefore: sentinel?.notes ?? null, installAgeDays: Math.round((Date.now() - lsInstall.createdAt) / 864e5) });
      await setMeta("install", { id: lsInstall.id, createdAt: Date.now() });
    } else if (idbInstall && !lsInstall) {
      result.localStorageCleared = true;
      warn("storage", "localStorage was cleared (settings/API key may need re-entering)");
      writeLS(LS_INSTALL, idbInstall);
    } else if (sentinel && sentinel.notes > 0 && noteCount === 0) {
      // Both markers exist but every note is gone.
      result.evicted = true;
      result.notesBefore = sentinel.notes;
      error("storage", "all notes are missing although the library had notes before", { notesBefore: sentinel.notes });
    }

    const dirty = readLS<{ noteId: string; t: number }>(LS_DIRTY);
    if (dirty) {
      result.uncleanExit = { ageMs: Date.now() - dirty.t };
      error("save", "previous session ended with unsaved edits", { ageSec: Math.round((Date.now() - dirty.t) / 1000) });
      delLS(LS_DIRTY);
    }
  } catch (e) {
    error("boot", "startup checks failed", { err: String((e as Error)?.message ?? e) });
  }
  boot = result;
  return result;
}

// --- the checks shown in Settings and attached to reports ---------------------------------------------------------

export async function runHealthChecks(): Promise<HealthItem[]> {
  const items: HealthItem[] = [];
  const add = (id: string, label: string, status: HealthItem["status"], detail: string) => items.push({ id, label, status, detail });

  // 1. can we write and read back from the database?
  try {
    const t0 = performance.now();
    // A unique key per probe: two checks running at once (React dev double-runs, or two tabs)
    // must not read each other's value and report a false alarm.
    const probe = { t: Date.now(), r: Math.random() };
    const key = `canary:${probe.r}`;
    await setMeta(key, probe);
    const back = await getMeta<typeof probe>(key);
    await (await db()).delete("meta", key);
    const ms = Math.round(performance.now() - t0);
    if (back?.r === probe.r) add("db", "Local database", ms > 300 ? "warn" : "ok", ms > 300 ? `Works, but slow (${ms} ms for a write+read).` : `Read/write works (${ms} ms).`);
    else add("db", "Local database", "bad", "A value written to the database didn't read back correctly.");
  } catch (e) {
    add("db", "Local database", "bad", `The database isn't usable: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }

  // 2. storage durability
  try {
    const s = navigator.storage;
    const persisted = s?.persisted ? await s.persisted() : null;
    const est = s?.estimate ? await s.estimate() : null;
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (persisted) add("persist", "Protected storage", "ok", "The browser has promised not to evict your notes.");
    else add("persist", "Protected storage", standalone ? "warn" : "warn", standalone ? "Not granted yet — it's usually granted after a few uses of the installed app." : "Not granted. Add the app to your Home Screen (Share → Add to Home Screen) so Safari keeps your notes.");
    if (est?.usage != null && est.quota) {
      const pct = (100 * est.usage) / est.quota;
      add("quota", "Storage space", pct > 80 ? "bad" : pct > 60 ? "warn" : "ok", `${(est.usage / 1048576).toFixed(0)} MB used of ~${(est.quota / 1048576).toFixed(0)} MB (${pct.toFixed(1)}%).`);
    }
    add("installed", "Installed as an app", standalone ? "ok" : "info", standalone ? "Running as an installed app." : "Running in a browser tab. Installing it protects your notes from being cleared.");
  } catch { add("persist", "Protected storage", "info", "Couldn't read storage status."); }

  // 3. data-loss tripwires from this session's boot
  if (boot.evicted) add("evicted", "Storage was cleared", "bad", boot.notesBefore ? `The browser cleared this app's storage — you had ${boot.notesBefore} notes. Restore from your latest backup (Settings → Restore from backup).` : "The browser cleared this app's storage. Restore from your latest backup.");
  if (boot.uncleanExit) add("unclean", "Last session ended unexpectedly", "warn", `The app closed with edits that may not have been saved (${Math.round(boot.uncleanExit.ageMs / 1000)} s of work at risk). Check the most recent note.`);

  // 4. backups
  try {
    const last = await lastBackupAt();
    const notes = await (await db()).count("notes");
    if (!notes) add("backup", "Backup", "info", "No notes yet.");
    else if (!last) add("backup", "Backup", "bad", "You have never backed up. If this browser clears its storage, everything is lost.");
    else {
      const days = (Date.now() - last) / 864e5;
      add("backup", "Backup", days > 30 ? "bad" : days > 7 ? "warn" : "ok", `Last backup ${days < 1 ? "today" : `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"} ago`}.`);
    }
  } catch { /* ignore */ }

  // 5. offline support
  try {
    if (!("serviceWorker" in navigator)) add("sw", "Offline support", "warn", "This browser doesn't support service workers, so the app can't work offline.");
    else {
      const reg = await navigator.serviceWorker.getRegistration();
      add("sw", "Offline support", reg?.active ? "ok" : "info", reg?.active ? "The app is cached and works offline." : "Not cached yet (normal in development, or on first visit — it installs after the first load).");
    }
  } catch { /* ignore */ }

  // 6. recent errors
  try {
    const day = 24 * 3600 * 1000;
    const errs = await errorCountSince(day);
    const saves = await errorCountSince(day, "save");
    if (saves) add("saves", "Saving", "bad", `${saves} save failure${saves === 1 ? "" : "s"} in the last 24 hours.`);
    else add("saves", "Saving", "ok", "No save failures in the last 24 hours.");
    add("errors", "Errors", errs > 5 ? "bad" : errs > 0 ? "warn" : "ok", errs ? `${errs} error${errs === 1 ? "" : "s"} logged in the last 24 hours — share a diagnostics report so they can be fixed.` : "No errors in the last 24 hours.");
  } catch { /* ignore */ }

  // 7. AI configuration sanity
  const s = getSettings();
  if (s.aiEnabled && !s.apiKey.trim()) add("ai", "AI features", "warn", "AI is switched on but no API key is set.");
  else if (s.aiEnabled) add("ai", "AI features", "ok", "Enabled with an API key.");
  else add("ai", "AI features", "info", "Off (nothing is sent anywhere).");

  return items;
}
