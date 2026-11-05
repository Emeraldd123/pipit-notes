// Settings → "Your laptop's AI": the address of a model running on your own computer, a Test button that shows
// whether it's reachable and can read a picture, and a short setup guide (Ollama + Tailscale).
import { useState } from "react";
import { Check, Laptop, Loader2 } from "lucide-react";
import { updateSettings, useSettings } from "@/lib/settings";
import { testLocal, type LocalTest } from "@/lib/local-ai";
import { Button } from "@/components/ui";
import { FEATURE_LABEL } from "@/lib/ai-cost";
import { budgetFor, localAllowed } from "@/lib/local-ai-core";

/** A small picture of a handwritten-looking sum, so the test shows whether the model can actually read images. */
function testPicture(sum: string): string {
  const c = document.createElement("canvas");
  c.width = 220; c.height = 90;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#1c1c1a"; g.font = "italic 44px Georgia, serif"; g.fillText(sum, 22, 60);
  return c.toDataURL("image/png");
}

/** At the measured speed, which jobs the laptop takes and which stay on Claude (so nobody waits a minute for a math check). */
function SpeedSplit({ ms, scope }: { ms: number; scope: "light" | "most" }) {
  const jobs = Object.keys(FEATURE_LABEL).filter((f) => localAllowed(f, scope));
  const laptop = jobs.filter((f) => ms <= budgetFor(f)), claude = jobs.filter((f) => ms > budgetFor(f));
  const names = (fs: string[]) => fs.map((f) => FEATURE_LABEL[f]).join(", ");
  return (
    <span className="mt-1 block text-foreground-muted">
      {laptop.length ? <>At this speed the laptop takes: {names(laptop)}.</> : <>That&apos;s too slow for any job here.</>}
      {claude.length > 0 && <> Too slow to wait for, so these stay on Claude: {names(claude)}.</>} It re-measures as you use it.
    </span>
  );
}

export function LaptopAi() {
  const s = useSettings();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<LocalTest | null>(null);
  const [sum, setSum] = useState("");
  const field = "mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary";

  async function test() {
    setTesting(true); setResult(null);
    // a new sum each time: the model can't reuse a cached answer (which made the timing look instant), and the
    // reply shows whether it really read the picture
    const next = `${10 + Math.floor(Math.random() * 90)} + ${10 + Math.floor(Math.random() * 90)}`;
    setSum(next);
    try { setResult(await testLocal(testPicture(next))); } finally { setTesting(false); }
  }

  return (
    <div className="mt-5 rounded-xl border border-border p-4">
      <p className="flex items-center gap-2 text-sm font-medium"><Laptop size={15} /> Your laptop&apos;s AI <span className="text-xs font-normal text-foreground-muted">(free, private)</span></p>
      <p className="mt-1 text-xs text-foreground-muted">When your laptop is on and reachable, reading handwriting, maths, working checks and short answers run on a model there: free, and the page never leaves your devices. When it isn&apos;t reachable, or its answer doesn&apos;t make sense, the job goes to Claude as usual. Exams always use Claude.</p>
      <label className="mt-3 flex items-center justify-between gap-3 text-sm">
        <span><strong>Try the laptop first</strong></span>
        <input type="checkbox" checked={s.localEnabled} onChange={(e) => updateSettings({ localEnabled: e.target.checked })} className="h-5 w-5 accent-[var(--primary)]" />
      </label>
      {s.localEnabled && (<>
        <label className="mt-3 block text-xs text-foreground-muted">Laptop address
          <input value={s.localUrl} onChange={(e) => updateSettings({ localUrl: e.target.value })} placeholder="https://zenbook.tail1234.ts.net" autoCapitalize="off" autoCorrect="off" spellCheck={false} className={`${field} font-mono`} />
        </label>
        <label className="mt-3 block text-xs text-foreground-muted">Model on the laptop (leave empty to use the first one that can read images)
          <input value={s.localModel} onChange={(e) => updateSettings({ localModel: e.target.value })} placeholder="qwen3-vl:8b-instruct" list="laptop-models" autoCapitalize="off" autoCorrect="off" spellCheck={false} className={`${field} font-mono`} />
          <datalist id="laptop-models">{result?.models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <label className="mt-3 block text-xs text-foreground-muted">What it does
          <select value={s.localScope} onChange={(e) => updateSettings({ localScope: e.target.value as "light" | "most" })} className={field}>
            <option value="light">Reading and short answers (handwriting, maths, working, chemistry, search answers, follow-ups)</option>
            <option value="most">Also Explain, flashcards, maps, page review and LaTeX (slower; a small model makes more mistakes)</option>
          </select>
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={test} disabled={testing || !s.localUrl.trim()}>{testing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Test the laptop</Button>
          {result && (
            <span className={`text-xs ${result.ok && result.vision ? "text-positive" : "text-negative"}`}>
              {!result.ok ? `Not reachable: ${result.reason}.`
                : result.vision ? `Reachable. ${result.model} read the test picture as "${result.reads}" (it says ${sum}) in ${((result.ms ?? 0) / 1000).toFixed(1)} s.`
                : `Reachable, but ${result.model}: ${result.reason}.`}
              {result.models.length > 1 && <span className="block text-foreground-muted">On the laptop: {result.models.join(", ")}</span>}
              {result.vision && result.ms != null && <SpeedSplit ms={result.ms} scope={s.localScope} />}
            </span>
          )}
        </div>
        <details className="mt-3 text-xs text-foreground-muted">
          <summary className="cursor-pointer">How to set it up (about 15 minutes, once)</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5">
            <li>On the laptop, install <strong>Ollama</strong> (ollama.com; it runs natively on Snapdragon). In a terminal: <code>ollama pull qwen3-vl:8b-instruct</code> (reads handwriting and maths, 6.2 GB). For quicker but rougher reading, also try <code>qwen3-vl:4b-instruct</code> (3.3 GB). The instruct versions answer straight away instead of thinking first, which matters on a laptop.</li>
            <li>Let this app talk to it: in Windows, open <em>Edit environment variables for your account</em>, add <code>OLLAMA_ORIGINS</code> = <code>{typeof location !== "undefined" ? location.origin : "https://bensnotes.netlify.app"}</code> and <code>OLLAMA_CONTEXT_LENGTH</code> = <code>16384</code> (the default of 4096 is too small for a page picture plus its answer), then quit Ollama from the tray and start it again.</li>
            <li>Install <strong>Tailscale</strong> on the laptop and the iPad and sign in to the same account on both. Ollama refuses requests that arrive under the Tailscale name, so start the small relay in <code>tools/laptop-relay.mjs</code> (<code>node tools/laptop-relay.mjs</code>; it listens on 127.0.0.1 only and passes requests on as localhost, and you can add it to the Startup folder), then run <code>tailscale serve --bg 11435</code>. It prints an address like <code>https://zenbook.tail1234.ts.net</code>: paste it above. (The app is https, so a plain http:// address would be blocked; Tailscale gives it a proper certificate, and it works away from home too.)</li>
            <li>Tap <strong>Test the laptop</strong>. A 403 means Tailscale is pointing straight at Ollama (port 11434) instead of the relay (11435). Don't set <code>OLLAMA_HOST</code> to <code>0.0.0.0</code> to get round it: that opens Ollama, with no password, to everyone on the same Wi-Fi.</li>
            <li>Keep the laptop plugged in and set not to sleep while you study. If it&apos;s off, everything still works through Claude.</li>
          </ol>
        </details>
      </>)}
    </div>
  );
}
