// First-run guide, shown in the Library while there are no notes yet: the three things a new person needs to know
// (install it so notes are kept, AI is optional and uses your own key, back up). Dismissed once, gone for good.
import { useState } from "react";
import { X } from "lucide-react";
import { go } from "@/router";
import { aiReady, useSettings } from "@/lib/settings";
import { Button, Card } from "@/components/ui";

const KEY = "pipit.welcomed";
const seen = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

export function Welcome() {
  const s = useSettings();
  const [hidden, setHidden] = useState(seen);
  if (hidden) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, "1"); } catch { /* storage unavailable */ } setHidden(true); };
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ai = aiReady(s);
  const step = (n: number, done: boolean) => (
    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white ${done ? "bg-positive" : "bg-primary"}`}>{done ? "✓" : n}</span>
  );
  return (
    <Card className="relative mx-auto mt-6 max-w-lg px-6 py-5 text-left">
      <button onClick={dismiss} aria-label="Dismiss getting started" className="absolute right-3 top-3 rounded-lg p-1.5 text-foreground-muted hover:bg-surface-secondary"><X size={16} /></button>
      <h3 className="text-base font-semibold">Getting started</h3>
      <ol className="mt-3 space-y-3.5 text-sm">
        <li className="flex gap-3">{step(1, installed)}
          <span><strong>Add it to your Home Screen.</strong> <span className="text-foreground-muted">{installed ? "Done. Installed apps get protected storage." : "In Safari: Share → Add to Home Screen, then open it from there. Your notes live on this device, and Safari can clear them for sites that aren't installed."}</span></span>
        </li>
        <li className="flex gap-3">{step(2, ai)}
          <span><strong>AI is optional.</strong> <span className="text-foreground-muted">{ai ? "Set up. Change it any time in Settings." : "Writing, PDFs, graphs, Python and flashcard review all work without it. To read handwriting, check working or write practice exams, add your own key: Google Gemini (has a free tier) or Anthropic Claude (a few dollars a month in normal use)."}</span>
            {!ai && <span className="mt-2 block"><Button onClick={() => go({ name: "settings" })}>Set up AI in Settings</Button></span>}
          </span>
        </li>
        <li className="flex gap-3">{step(3, false)}
          <span><strong>Back up now and then.</strong> <span className="text-foreground-muted">There&apos;s no account and nothing is uploaded, so a backup is your only copy elsewhere. Settings → Back up now → Save to Files. The app reminds you weekly.</span></span>
        </li>
      </ol>
      <div className="mt-4 flex justify-end"><Button variant="primary" onClick={dismiss}>Got it</Button></div>
    </Card>
  );
}
