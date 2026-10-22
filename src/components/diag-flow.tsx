import { useShareFlow, shareOrDownload } from "@/components/backup-flow";
import { buildReport } from "@/lib/report";

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

/** Build a content-free diagnostics report, then Save/AirDrop it from a fresh tap. */
export function useDiagFlow(onResult: (msg: string) => void, trigger = "manual") {
  return useShareFlow({
    build: async () => new File([JSON.stringify(await buildReport(trigger), null, 2)], `pipit-notes-diagnostics-${stamp()}.json`, { type: "application/json" }),
    save: (f) => shareOrDownload(f, "Pipit Notes diagnostics"),
    title: "Diagnostics report ready",
    hint: "This file contains counts, timings, device info and error messages only — never your notes, titles, or your API key. Tap Save, then send it to whoever is fixing the problem.",
    doneShared: "Report saved.",
    doneDownloaded: "Report downloaded.",
    failed: "Couldn't build the report",
  }, onResult);
}
