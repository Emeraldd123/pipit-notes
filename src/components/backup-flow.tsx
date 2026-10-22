import { useState, type ReactNode } from "react";
import { Loader2, Upload } from "lucide-react";
import { buildBackupFile, saveBackupFile, shareOrDownload } from "@/lib/backup";
import { formatBytes } from "@/lib/format";
import { Button, Modal } from "@/components/ui";

type How = "shared" | "downloaded" | "cancelled";

/**
 * Two-step "build a file, then Save it": building can take seconds, and Safari only
 * allows the share sheet right after a tap — so the share call is made from a fresh
 * 'Save' tap in a dialog rather than straight after the (slow) build.
 */
export function useShareFlow(opts: {
  build: () => Promise<File>;
  save: (file: File) => Promise<How>;
  title: string;
  hint: string;
  doneShared: string;
  doneDownloaded: string;
  failed: string;
}, onResult: (msg: string) => void): { start: () => void; building: boolean; modal: ReactNode } {
  const [building, setBuilding] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function start() {
    setBuilding(true);
    try {
      setFile(await opts.build());
    } catch (e) {
      onResult(`${opts.failed}: ${(e as Error).message}`);
    } finally {
      setBuilding(false);
    }
  }

  async function save() {
    if (!file) return;
    setSaving(true);
    try {
      const how = await opts.save(file);
      if (how === "cancelled") return; // leave the dialog open so they can try again
      onResult(how === "shared" ? opts.doneShared : opts.doneDownloaded);
      setFile(null);
    } catch (e) {
      onResult(`${opts.failed}: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const modal = file ? (
    <Modal title={opts.title} onClose={() => setFile(null)}>
      <p className="text-sm text-foreground-muted">{file.name} · {formatBytes(file.size)}</p>
      <p className="mt-3 text-sm">{opts.hint}</p>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" onClick={save} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Save</Button>
        <Button onClick={() => setFile(null)}>Cancel</Button>
      </div>
    </Modal>
  ) : null;

  return { start: () => void start(), building, modal };
}

export function useBackupFlow(onResult: (msg: string) => void) {
  return useShareFlow({
    build: buildBackupFile,
    save: saveBackupFile,
    title: "Backup ready",
    hint: "Tap Save, then choose Save to Files → iCloud Drive (or AirDrop it to another device).",
    doneShared: "Backup saved.",
    doneDownloaded: "Backup downloaded — keep it somewhere safe (iCloud Drive).",
    failed: "Backup failed",
  }, onResult);
}

export { shareOrDownload };
