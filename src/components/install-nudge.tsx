// A reminder that stays in the Library on a touch device until the app is opened from the Home Screen. Notes kept in
// a plain Safari tab can be cleared by the browser, and the getting-started card disappears after the first note.
import { useState } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui";

const KEY = "pipit.installNudge";
const SNOOZE_MS = 3 * 864e5;
const snoozed = () => { try { return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < SNOOZE_MS; } catch { return false; } };

export function InstallNudge() {
  const [hidden, setHidden] = useState(snoozed);
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  if (hidden || installed || !touch) return null;
  return (
    <Card className="mb-5 flex items-start justify-between gap-3 border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <p className="text-sm"><strong>You&apos;re in a browser tab.</strong> Safari can clear notes kept in a tab. Tap Share, then Add to Home Screen, and open Pipit from there. The Home Screen app keeps its own notes, so back up here first (Settings → Back up now) and restore there.</p>
      <button type="button" aria-label="Remind me later" title="Remind me later" onClick={() => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage unavailable */ } setHidden(true); }}
        className="tap -mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-muted hover:bg-surface-secondary"><X size={16} /></button>
    </Card>
  );
}
