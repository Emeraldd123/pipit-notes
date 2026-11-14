// Settings → "Google Gemini": a key (paid from your Google credit), the model, which jobs it does, a monthly cap,
// this month's spend, and a Test button.
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { hasKey, updateSettings, useSettings } from "@/lib/settings";
import { geminiSpent, onGeminiSpend, testGemini } from "@/lib/gemini";
import { GEMINI_DEFAULT_MODEL } from "@/lib/gemini-core";
import { Button } from "@/components/ui";

const MODELS = [
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite: fast, cheap, reads handwriting well (recommended)" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite: cheapest" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash: more careful, about 3× the price" },
];

export function GeminiAi() {
  const s = useSettings();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof testGemini>> | null>(null);
  const [spent, setSpent] = useState<{ calls: number; usd: number } | null>(null);
  useEffect(() => { const load = () => void geminiSpent().then(setSpent); load(); return onGeminiSpend(load); }, []);
  // a newly pasted key is checked once, straight away, so a typo shows up here and not at the first exam
  const checked = useRef(s.geminiKey.trim());
  useEffect(() => {
    const key = s.geminiKey.trim();
    if (key.length <= 20 || key === checked.current) return;
    const t = setTimeout(async () => {
      checked.current = key;
      setTesting(true); setResult(null);
      try { setResult(await testGemini()); } finally { setTesting(false); }
    }, 1200);
    return () => clearTimeout(t);
  }, [s.geminiKey]);
  const field = "mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary";
  const model = s.geminiModel || GEMINI_DEFAULT_MODEL;

  return (
    <div className="mt-5 rounded-xl border border-border p-4">
      <p className="flex items-center gap-2 text-sm font-medium"><Sparkles size={15} /> Google Gemini <span className="text-xs font-normal text-foreground-muted">(paid from your Google credit)</span></p>
      <p className="mt-1 text-xs text-foreground-muted">With a Gemini key, reading handwriting, maths, working checks and short answers go to Gemini before Claude: a few seconds each, paid from your Google credit. If Gemini is unavailable or its answer doesn&apos;t make sense, the job goes to Claude.</p>
      <label className="mt-3 block text-xs text-foreground-muted">Gemini API key
        <input type="password" value={s.geminiKey} onChange={(e) => updateSettings({ geminiKey: e.target.value, ...(e.target.value.trim().length > 20 && !s.geminiKey.trim() ? { aiEnabled: true } : {}) })} placeholder="From aistudio.google.com → Get API key" autoComplete="off" autoCapitalize="off" spellCheck={false} className={`${field} font-mono`} />
        <span className="mt-1 block">Create it in a Google Cloud project that has billing (your credit) attached. Keys on the free tier work too, but Google may use free-tier requests to improve its products. Stored only on this device.</span>
      </label>
      {s.geminiKey.trim() && (<>
        <label className="mt-3 block text-xs text-foreground-muted">Model
          <select value={model} onChange={(e) => updateSettings({ geminiModel: e.target.value })} className={field}>
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            {!MODELS.some((m) => m.id === model) && <option value={model}>{model}</option>}
          </select>
        </label>
        <label className="mt-3 block text-xs text-foreground-muted">What it does
          <select value={s.geminiScope} onChange={(e) => updateSettings({ geminiScope: e.target.value as "light" | "most" })} className={field}>
            <option value="light">Reading and short answers (handwriting, maths, working, math check, search answers, follow-ups)</option>
            <option value="most">Also Explain, flashcards, maps, page review and LaTeX</option>
          </select>
        </label>
        <label className="mt-3 block text-xs text-foreground-muted">Monthly cap for Gemini (US dollars, 0 = no cap)
          <input type="number" min={0} step={1} inputMode="decimal" value={s.geminiBudgetUsd || ""} placeholder="0" onChange={(e) => updateSettings({ geminiBudgetUsd: Math.max(0, Number(e.target.value) || 0) })} className={field} />
          <span className="mt-1 block">
            This month: {(spent?.usd ?? 0) > 0 && (spent?.usd ?? 0) < 0.01 ? "under 1¢" : `about $${(spent?.usd ?? 0).toFixed(2)}`} over {spent?.calls ?? 0} request{spent?.calls === 1 ? "" : "s"}{s.geminiBudgetUsd > 0 ? ` of $${s.geminiBudgetUsd}` : ""}. At the cap, jobs go to Claude instead. An estimate from token counts; Google&apos;s billing page has the real figure.
          </span>
        </label>
        <p className="mt-3 rounded-lg bg-surface-secondary px-3 py-2 text-xs text-foreground-muted">
          {hasKey(s)
            ? <><strong>With both keys:</strong> Gemini takes the jobs above; exams and marking are written by Claude; anything Gemini can&apos;t do falls back to Claude.</>
            : <><strong>With only a Gemini key:</strong> everything runs on Gemini, including exams, marking and Explain (on the stronger Gemini 3.8 Flash). Exams were tuned on Claude, so Gemini&apos;s are less tested: report any broken question from the exam screen.</>}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={async () => { setTesting(true); setResult(null); try { setResult(await testGemini()); } finally { setTesting(false); } }} disabled={testing}>
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Test Gemini
          </Button>
          {result && <span className={`text-xs ${result.ok ? "text-positive" : "text-negative"}`}>{result.ok ? `Works: ${result.model} answered in ${((result.ms ?? 0) / 1000).toFixed(1)} s.` : `Didn't work: ${result.reason}.`}</span>}
        </div>
      </>)}
    </div>
  );
}
