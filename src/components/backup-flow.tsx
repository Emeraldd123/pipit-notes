import { useState, type ReactNode } from "react";
import { Loader2, Upload } from "lucide-react";
import { buildBackupFile, saveBackupFile } from "@/lib/backup";
import { formatBytes } from "@/lib/format";
import { Button, Modal } from "@/components/ui";

/**
 * Two-step backup: build the file, then show a "Save" button so the share sheet is
 * opened from a fresh tap (Safari rejects share() after a long async gap).
 */
export function useBackupFlow(onResult: (msg: string) => void): { start: () => void; building: boolean; modal: ReactNode } {
  const [building, setBuilding] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function start() {
    setBuilding(true);
    try {
      setFile(await buildBackupFile());
    } catch (e) {
      onResult("Backup failed: " + (e as Error).message);
    } finally {
      setBuilding(false);
    }
  }

  async function save() {
    if (!file) return;
    setSaving(true);
    try {
      const how = await saveBackupFile(file);
      if (how === "cancelled") return; // leave the dialog open so they can try again
      onResult(how === "shared" ? "Backup saved." : "Backup downloaded — keep it somewhere safe (iCloud Drive).");
      setFile(null);
    } catch (e) {
      onResult("Couldn't save the backup: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const modal = file ? (
    <Modal title="Backup ready" onClose={() => setFile(null)}>
      <p className="text-sm text-foreground-muted">{file.name} · {formatBytes(file.size)}</p>
      <p className="mt-3 text-sm">Tap <strong>Save</strong>, then choose <strong>Save to Files → iCloud Drive</strong> (or AirDrop it to another device).</p>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" onClick={save} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Save</Button>
        <Button onClick={() => setFile(null)}>Cancel</Button>
      </div>
    </Modal>
  ) : null;

  return { start: () => void start(), building, modal };
}
