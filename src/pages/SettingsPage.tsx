import { useEffect, useRef, useState } from "react";
import { Activity, ArrowLeft, Check, Database, Download, HardDrive, KeyRound, Loader2, Pencil, ShieldCheck, Upload } from "lucide-react";
import { go } from "@/router";
import { importBackups, lastBackupAt } from "@/lib/backup";
import { useBackupFlow } from "@/components/backup-flow";
import { requestPersistentStorage } from "@/lib/db";
import { formatBytes, timeAgo } from "@/lib/format";
import { aiReady, updateSettings, useSettings } from "@/lib/settings";
import { claude } from "@/lib/ai";
import { FEATURE_LABEL, monthByFeature, monthKey, monthTotal, type Ledger } from "@/lib/ai-cost";
import { loadLedger, onLedgerChange, resetLedger } from "@/lib/ai-ledger";
import { Button, Card, Modal, Toast } from "@/components/ui";
import { PenTest } from "@/components/pentest";
import { useDiagFlow } from "@/components/diag-flow";
import { runHealthChecks } from "@/lib/health";
import { sendReport } from "@/lib/report";
import { APP, clearLog, getRecent } from "@/lib/telemetry";
import type { HealthItem } from "@/lib/telemetry-core";
import type { LogEntry } from "@/types";

const MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — recommended ($2 in / $10 out per million tokens)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 ($2 / $10)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 — most accurate ($4 / $20)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — cheapest ($0.10 / $0.50)" },
];
const ECONOMY_MODELS = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 ($0.10 / $0.50)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (same as main)" },
];

export function SettingsPage() {
  const s = useSettings();
  const [storage, setStorage] = useState<{ persisted: boolean; usage?: number; quota?: number } | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [penTest, setPenTest] = useState(false);
  const [health, setHealth] = useState<HealthItem[] | null>(null);
  const [events, setEvents] = useState<LogEntry[] | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [sending, setSending] = useState(false);
  const diag = useDiagFlow((m) => flash(m));
  const restoreRef = useRef<HTMLInputElement>(null);
  const backup = useBackupFlow((m) => { flash(m); setLast(Date.now()); });
  const standalone = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

  useEffect(() => { void requestPersistentStorage().then(setStorage); void lastBackupAt().then(setLast); void runHealthChecks().then(setHealth); }, []);
  useEffect(() => { if (events) void getRecent(200, onlyProblems).then(setEvents); }, [onlyProblems]); // eslint-disable-line react-hooks/exhaustive-deps
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 3500); };

  async function onRestore(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setBusy("Restoring…");
    try {
      const r = await importBackups(files, setBusy);
      flash(`${r.imported} imported, ${r.replaced} updated, ${r.skipped} already up to date${r.errors.length ? " — " + r.errors[0] : ""}.`);
    } finally { setBusy(null); }
  }
  async function testKey() {
    setTesting(true);
    try {
      await claude({ user: "Reply with the single word: ok", maxTokens: 8, feature: "test", model: s.model });
      if (s.economy && s.economyModel !== s.model) await claude({ user: "Reply with the single word: ok", maxTokens: 8, feature: "test", model: s.economyModel });
      flash("Connected — the key works" + (s.economy && s.economyModel !== s.model ? " (both models)." : "."));
    }
    catch (e) { flash((e as Error).message); } finally { setTesting(false); }
  }

  return (
    <div className="paper-bg safe-t min-h-full">
      <div className="mx-auto max-w-2xl px-5 py-6 md:py-10">
        <button onClick={() => go({ name: "library", notebook: null, q: "" })} className="mb-6 flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"><ArrowLeft size={15} /> All notes</button>
        <h1 className="serif text-4xl tracking-tight">Settings <span className="serif-i text-primary">&amp; backup</span></h1>

        <Section icon={<ShieldCheck size={16} />} title="Keeping your notes safe">
          <p className="text-sm text-foreground-muted">Your notes live in this browser&apos;s storage — fast, private, and available offline. The catch: Safari can clear storage for sites that aren&apos;t installed. Do both of these and you&apos;re covered.</p>
          <ol className="mt-3 space-y-2.5 text-sm">
            <Step done={standalone}>
              <strong>Add to Home Screen.</strong> In Safari: Share → <em>Add to Home Screen</em>. Installed apps get protected storage.{standalone ? " (You're running installed — nice.)" : ""}
            </Step>
            <Step done={!!storage?.persisted}>
              <strong>Persistent storage {storage?.persisted ? "granted" : "not granted yet"}.</strong> {storage?.persisted ? "The browser won't evict your notes under pressure." : "It's usually granted once the app is installed and used a few times."}
              {storage?.usage != null && <span className="text-foreground-muted"> Using {formatBytes(storage.usage)}{storage.quota ? ` of ~${formatBytes(storage.quota)}` : ""}.</span>}
            </Step>
            <Step done={!!last && Date.now() - last < 7 * 864e5}>
              <strong>Back up regularly.</strong> {last ? `Last backup ${timeAgo(last)}.` : "No backup yet."} Save the file to iCloud Drive from the share sheet.
            </Step>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={backup.start} disabled={!!busy || backup.building}>{backup.building ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {backup.building ? "Building…" : "Back up now"}</Button>
            <Button onClick={() => restoreRef.current?.click()} disabled={!!busy}><Download size={14} /> Restore from backup</Button>
          </div>
          {busy && <p className="mt-3 flex items-center gap-2 text-xs text-foreground-muted"><Loader2 size={12} className="animate-spin" /> {busy}</p>}
          <input ref={restoreRef} type="file" accept=".zip,application/zip" multiple hidden onChange={onRestore} />
          <p className="mt-3 text-xs text-foreground-muted">A backup is one <code>.pipitnotes.zip</code> with everything (ink, images, blocks). Restoring merges into what&apos;s on this device — newer wins per note — so it also moves notes between devices.</p>
        </Section>

        <Section icon={<KeyRound size={16} />} title="AI features">
          <p className="text-sm text-foreground-muted">Recognising maths, checking working, reading handwriting for search, answering questions and writing practice exams use an AI model. Pages are sent <strong>straight from this device to Anthropic</strong> with your own key — only when you use one of those features, and never when this switch is off.</p>
          <label className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm">
            <span><strong>Enable AI features</strong><span className="block text-xs text-foreground-muted">Off by default.</span></span>
            <input type="checkbox" checked={s.aiEnabled} onChange={(e) => updateSettings({ aiEnabled: e.target.checked })} className="h-5 w-5 accent-[var(--primary)]" />
          </label>
          <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm">
            <span><strong>Keep search up to date automatically</strong><span className="block text-xs text-foreground-muted">When you leave a note, pages you changed are read so search stays fresh (one AI call per changed page). Off by default.</span></span>
            <input type="checkbox" checked={s.autoIndex} disabled={!s.aiEnabled} onChange={(e) => updateSettings({ autoIndex: e.target.checked })} className="h-5 w-5 accent-[var(--primary)]" />
          </label>
          <label className="mt-3 block text-xs text-foreground-muted">Anthropic API key
            <input type="password" value={s.apiKey} onChange={(e) => updateSettings({ apiKey: e.target.value })} placeholder="sk-ant-…" autoComplete="off" autoCapitalize="off" spellCheck={false}
              className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 font-mono text-sm text-foreground outline-none focus:border-primary" />
          </label>
          <label className="mt-3 block text-xs text-foreground-muted">Model
            <select value={s.model} onChange={(e) => updateSettings({ model: e.target.value })} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground">
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              {!MODELS.some((m) => m.id === s.model) && <option value={s.model}>{s.model}</option>}
            </select>
          </label>
          <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm">
            <span><strong>Use the cheaper model for simple jobs</strong><span className="block text-xs text-foreground-muted">Reading handwriting for search, follow-up questions and link explanations. Exams, marking, review, Explain, flashcards and maps always use your main model.</span></span>
            <input type="checkbox" checked={s.economy} disabled={!s.aiEnabled} onChange={(e) => updateSettings({ economy: e.target.checked })} className="h-5 w-5 accent-[var(--primary)]" />
          </label>
          {s.economy && (
            <label className="mt-3 block text-xs text-foreground-muted">Cheaper model
              <select value={s.economyModel} onChange={(e) => updateSettings({ economyModel: e.target.value })} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground">
                {ECONOMY_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                {!ECONOMY_MODELS.some((m) => m.id === s.economyModel) && <option value={s.economyModel}>{s.economyModel}</option>}
              </select>
            </label>
          )}
          <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm">
            <span><strong>Careful mode</strong><span className="block text-xs text-foreground-muted">Lets the model think harder before answering. Slower and costs noticeably more — worth it only if you see mistakes in its answers.</span></span>
            <input type="checkbox" checked={s.careful} disabled={!s.aiEnabled} onChange={(e) => updateSettings({ careful: e.target.checked })} className="h-5 w-5 accent-[var(--primary)]" />
          </label>
          <label className="mt-3 block text-xs text-foreground-muted">Monthly budget (US dollars, 0 = no limit)
            <input type="number" min={0} step={1} inputMode="decimal" value={s.monthlyBudgetUsd || ""} placeholder="0"
              onChange={(e) => updateSettings({ monthlyBudgetUsd: Math.max(0, Number(e.target.value) || 0) })}
              className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary" />
            <span className="mt-1 block">AI features pause when this month&apos;s estimated spend reaches it. Your real bill is in the Anthropic console.</span>
          </label>
          <AiUsagePanel budget={s.monthlyBudgetUsd} />
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={testKey} disabled={testing || !aiReady(s)}>{testing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Test connection</Button>
            <span className="text-xs text-foreground-muted">The key is stored only on this device.</span>
          </div>
        </Section>

        <Section icon={<Activity size={16} />} title="Health & diagnostics">
          <p className="text-sm text-foreground-muted">A live check of the things that can quietly go wrong, plus a content-free log so problems can be found and fixed.</p>
          <ul className="mt-3 space-y-2">
            {health === null ? <li className="text-sm text-foreground-muted">Checking…</li> : health.map((h) => (
              <li key={h.id} className="flex gap-3 text-sm">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] text-white ${h.status === "ok" ? "bg-positive" : h.status === "bad" ? "bg-negative" : h.status === "warn" ? "bg-amber-500" : "bg-foreground-muted/60"}`}>{h.status === "ok" ? "✓" : h.status === "bad" ? "✗" : h.status === "warn" ? "!" : "i"}</span>
                <span className="min-w-0"><strong>{h.label}.</strong> <span className="text-foreground-muted">{h.detail}</span></span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => { setHealth(null); void runHealthChecks().then(setHealth); }}>Re-check</Button>
            <Button variant="primary" onClick={diag.start} disabled={diag.building}>{diag.building ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {diag.building ? "Building…" : "Share a diagnostics report"}</Button>
            <Button onClick={async () => { setEvents(await getRecent(200, true)); setOnlyProblems(true); }}>View recent events</Button>
            <Button disabled={sending} onClick={async () => { setSending(true); const r = await sendReport("manual", true); setSending(false); flash(r.ok ? "Report sent." : r.status ? `Couldn't send (server said ${r.status}). Is the reporting endpoint deployed?` : `Couldn't send${r.skipped ? ` (${r.skipped})` : ""}.`); }}>{sending ? "Sending…" : "Send a report now"}</Button>
          </div>
          <label className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm">
            <span><strong>Keep a diagnostics log on this device</strong><span className="block text-xs text-foreground-muted">Errors, timings (saves, opening notes, pen input quality), and which features you use. Counts and timings only.</span></span>
            <input type="checkbox" checked={s.diagnostics} onChange={(e) => updateSettings({ diagnostics: e.target.checked })} className="h-5 w-5 accent-[var(--primary)]" />
          </label>
          <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm">
            <span><strong>Send reports automatically</strong><span className="block text-xs text-foreground-muted">When something breaks (and about once a day), a content-free report goes to this site&apos;s reporting endpoint. Off = nothing leaves the device unless you share a report yourself.</span></span>
            <input type="checkbox" checked={s.reportEnabled} disabled={!s.diagnostics} onChange={(e) => updateSettings({ reportEnabled: e.target.checked })} className="h-5 w-5 accent-[var(--primary)]" />
          </label>
          <label className="mt-3 block text-xs text-foreground-muted">Reporting endpoint (leave empty for this site&apos;s own)
            <input value={s.reportUrl} onChange={(e) => updateSettings({ reportUrl: e.target.value })} placeholder="/.netlify/functions/diag" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 font-mono text-sm text-foreground outline-none focus:border-primary" />
          </label>
          <p className="mt-3 text-xs text-foreground-muted"><strong>Never collected:</strong> your notes, handwriting, note titles, PDF contents, code you run, AI questions or answers, or your API key. <strong>Collected:</strong> counts (notes, strokes), timings, error messages, device/browser model, storage status, and which features were used. Version {APP.version} · build {APP.commit}.</p>
        </Section>

        <Section icon={<Pencil size={16} />} title="Pen test">
          <p className="text-sm text-foreground-muted">See exactly what your stylus reports on this device — sample rate, pressure, tilt, and stalls. Handy for checking a new iPad or Pencil.</p>
          <div className="mt-3"><Button onClick={() => setPenTest(true)}>Open pen test</Button></div>
        </Section>

        <Section icon={<HardDrive size={16} />} title="Appearance & handedness">
          <label className="block text-xs text-foreground-muted">Tool rail
            <span className="mt-1 flex gap-2">
              {(["left", "right"] as const).map((side) => (
                <button key={side} onClick={() => updateSettings({ railSide: side })} className={`flex-1 rounded-xl border px-3 py-2.5 text-sm ${s.railSide === side ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-foreground-muted hover:bg-surface-secondary"}`}>
                  {side === "left" ? "On the left (best if you write with your right hand)" : "On the right (best if you write left-handed)"}
                </button>
              ))}
            </span>
            <span className="mt-1 block">Keeps the tools under your resting, non-writing hand so your writing hand never reaches across the page.</span>
          </label>
          <label className="mt-4 block text-xs text-foreground-muted">Theme</label>
          <select value={s.theme} onChange={(e) => updateSettings({ theme: e.target.value as "system" | "light" | "dark" })} className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm">
            <option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </Section>

        <Section icon={<Database size={16} />} title="About">
          <p className="text-sm text-foreground-muted">Pipit Notes is a private, offline-first notebook. There is no account and no server: everything is stored on this device. Code blocks and step-checking run locally (Python in WebAssembly).</p>
        </Section>
      </div>
      {backup.modal}
      {penTest && <PenTest onClose={() => setPenTest(false)} />}
      {diag.modal}
      {events && (
        <Modal title="Recent events" onClose={() => setEvents(null)} wide>
          <div className="mb-3 flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} className="accent-[var(--primary)]" /> Only warnings and errors</label>
            <Button onClick={async () => { if (confirm("Clear the diagnostics log on this device?")) { await clearLog(); setEvents([]); } }}>Clear log</Button>
          </div>
          {events.length === 0 ? <p className="text-sm text-foreground-muted">Nothing logged{onlyProblems ? " — no warnings or errors." : "."}</p> : (
            <ul className="space-y-1.5">
              {events.map((e, i) => (
                <li key={e.id ?? i} className="rounded-lg border border-border px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 font-semibold uppercase ${e.level === "error" ? "bg-negative/15 text-negative" : e.level === "warn" ? "bg-amber-500/15 text-amber-600" : "bg-surface-secondary text-foreground-muted"}`}>{e.level}</span>
                    <span className="font-medium">{e.area}</span><span className="text-foreground-muted">{new Date(e.t).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 break-words">{e.msg}</p>
                  {e.data && Object.keys(e.data).length > 0 && <p className="mt-0.5 break-words font-mono text-[11px] text-foreground-muted">{JSON.stringify(e.data)}</p>}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
      <Toast msg={toast} />
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card className="mt-6 px-5 py-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-primary">{icon}<span className="text-foreground">{title}</span></h2>
      {children}
    </Card>
  );
}
function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] text-white ${done ? "bg-positive" : "bg-foreground-muted/60"}`}>{done ? "✓" : "·"}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** What AI has cost this month, by feature (an estimate from token counts × published prices; kept only on this device). */
function AiUsagePanel({ budget }: { budget: number }) {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  useEffect(() => {
    const load = () => void loadLedger().then((l) => setLedger({ ...l }));
    load();
    return onLedgerChange(load);
  }, []);
  if (!ledger) return null;
  const m = monthKey();
  const total = monthTotal(ledger, m);
  const rows = monthByFeature(ledger, m).slice(0, 6);
  const pct = budget > 0 ? Math.min(100, Math.round((total / budget) * 100)) : 0;
  return (
    <div className="mt-3 rounded-xl border border-border px-4 py-3 text-sm">
      <div className="flex items-baseline justify-between">
        <strong>AI usage this month</strong>
        <span className="tabular-nums">{total < 0.01 ? "under 1¢" : `≈ $${total.toFixed(2)}`}{budget > 0 ? ` of $${budget.toFixed(0)}` : ""}</span>
      </div>
      {budget > 0 && <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-secondary"><div className={`h-full rounded-full ${pct >= 90 ? "bg-negative" : pct >= 70 ? "bg-amber-500" : "bg-positive"}`} style={{ width: `${pct}%` }} /></div>}
      {rows.length === 0 ? <p className="mt-2 text-xs text-foreground-muted">Nothing yet this month.</p> : (
        <ul className="mt-2 space-y-1 text-xs text-foreground-muted">
          {rows.map((r) => <li key={r.feature} className="flex justify-between gap-3"><span className="truncate">{FEATURE_LABEL[r.feature] ?? r.feature} · {r.calls}×</span><span className="tabular-nums">{r.usd < 0.01 ? "<1¢" : `$${r.usd.toFixed(2)}`}</span></li>)}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-foreground-muted">An estimate from token counts and published prices — your Anthropic console has the real figure.{rows.length ? " " : ""}{rows.length ? <button className="underline" onClick={() => { if (confirm("Reset this device's usage estimate?")) void resetLedger(); }}>Reset</button> : null}</p>
    </div>
  );
}
