// First-run guide, shown in the Library while there are no notes yet: the three things a new person needs to know
// (install it so notes are kept, AI is optional and uses your own key, back up). Dismissed once, gone for good.
import { useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { go } from "@/router";
import { aiReady, useSettings } from "@/lib/settings";
import { Button, Card } from "@/components/ui";

const KEY = "pipit.welcomed";
const seen = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${done ? "bg-positive text-white" : "bg-primary/10 text-primary"}`}>
        {done ? <Check size={14} strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}{done && <span className="sr-only"> (done)</span>}</p>
        <div className="mt-0.5 text-foreground-muted">{children}</div>
      </div>
    </li>
  );
}

export function Welcome() {
  const s = useSettings();
  const [hidden, setHidden] = useState(seen);
  if (hidden) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, "1"); } catch { /* storage unavailable */ } setHidden(true); };
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ai = aiReady(s);
  return (
    <Card className="anim-rise relative mx-auto mt-5 max-w-lg px-5 py-5 text-left sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="serif text-2xl leading-tight">Getting started</h3>
          <p className="mt-0.5 text-sm text-foreground-muted">Three things worth knowing. It takes a minute.</p>
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss getting started" title="Dismiss"
          className="-mr-2 -mt-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-muted hover:bg-surface-secondary [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"><X size={16} /></button>
      </div>
      <ol className="mt-4 space-y-4 text-sm leading-relaxed">
        <Step n={1} done={installed} title="Add it to your Home Screen">
          {installed
            ? <p>Done. Installed apps get protected storage.</p>
            : <p>In Safari, tap Share, then Add to Home Screen, and open it from there. Your notes live on this device, and Safari can clear them for sites that aren&apos;t installed.</p>}
        </Step>
        <Step n={2} done={ai} title="AI is optional">
          {ai ? <p>Set up. Change it any time in Settings.</p> : (
            <>
              <p>Writing, PDFs, graphs, Python and flashcard review all work without it. Reading handwriting, checking working and writing practice exams need your own key: Google Gemini (has a free tier) or Anthropic Claude (a few dollars a month in normal use).</p>
              <Button className="mt-2.5" onClick={() => go({ name: "settings" })}>Set up AI in Settings</Button>
            </>
          )}
        </Step>
        <Step n={3} done={false} title="Back up now and then">
          <p>There&apos;s no account and nothing is uploaded, so a backup is your only other copy. Settings → Back up now → Save to Files. The app reminds you weekly.</p>
        </Step>
      </ol>
      <div className="mt-5 flex justify-end border-t border-border pt-4"><Button onClick={dismiss}>Got it</Button></div>
    </Card>
  );
}
