import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Database, Download, HardDrive, KeyRound, Loader2, ShieldCheck, Upload } from "lucide-react";
import { go } from "@/router";
import { importBackups, lastBackupAt } from "@/lib/backup";
import { useBackupFlow } from "@/components/backup-flow";
import { requestPersistentStorage } from "@/lib/db";
import { formatBytes, timeAgo } from "@/lib/format";
import { aiReady, updateSettings, useSettings } from "@/lib/settings";
import { claude } from "@/lib/ai";
import { Button, Card, Toast } from "@/components/ui";

const MODELS = [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 (recommended)" },
  { id: "claude-opus-5", label: "Claude Opus 5 (most accurate, slower)" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (cheapest)" },
];

export function SettingsPage() {
  const s = useSettings();
  const [storage, setStorage] = useState<{ persisted: boolean; usage?: number; quota?: number } | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const restoreRef = useRef<HTMLInputElement>(null);
  const backup = useBackupFlow((m) => { flash(m); setLast(Date.now()); });
  const standalone = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

  useEffect(() => { void requestPersistentStorage().then(setStorage); void lastBackupAt().then(setLast); }, []);
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
    try { await claude({ user: "Reply with the single word: ok", maxTokens: 8 }); flash("Connected — the key works."); }
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
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={testKey} disabled={testing || !aiReady(s)}>{testing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Test connection</Button>
            <span className="text-xs text-foreground-muted">The key is stored only on this device.</span>
          </div>
        </Section>

        <Section icon={<HardDrive size={16} />} title="Appearance">
          <select value={s.theme} onChange={(e) => updateSettings({ theme: e.target.value as "system" | "light" | "dark" })} className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm">
            <option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </Section>

        <Section icon={<Database size={16} />} title="About">
          <p className="text-sm text-foreground-muted">Pipit Notes is a private, offline-first notebook. There is no account and no server: everything is stored on this device. Code blocks and step-checking run locally (Python in WebAssembly).</p>
        </Section>
      </div>
      {backup.modal}
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
