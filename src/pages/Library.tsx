import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download, FileUp, Folder, FolderPlus, Loader2, NotebookPen, Pencil, Pin, Plus, Search, Settings as SettingsIcon, Trash2, Upload,
} from "lucide-react";
import type { NoteMeta, NotebookRec } from "@/types";
import {
  addImage, createNote, createNotebook, deleteNote, deleteNotebook, listNotebooks, listNotes, patchNote, putPageText,
} from "@/lib/db";
import { renderPdf } from "@/lib/pdf";
import { PAGE_H, PAGE_W, pageTop } from "@/lib/page";
import { downloadNotebookZip } from "@/lib/export";
import { loadExportNote } from "@/lib/note-io";
import { backupIsOverdue, backupNow, importBackups } from "@/lib/backup";
import { ensureThumb } from "@/lib/thumbs";
import { timeAgo } from "@/lib/format";
import { go } from "@/router";
import { Button, Card, Toast, Wordmark } from "@/components/ui";

export function Library({ notebook, q }: { notebook: string | null; q: string }) {
  const [notes, setNotes] = useState<NoteMeta[] | null>(null);
  const [notebooks, setNotebooks] = useState<NotebookRec[]>([]);
  const [filter, setFilter] = useState(q);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [overdue, setOverdue] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const [n, nb] = await Promise.all([listNotes(), listNotebooks()]);
    setNotes(n);
    setNotebooks(nb);
    setOverdue(await backupIsOverdue());
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 3200); };

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (notes ?? []).filter((n) => {
      if (notebook === "none" ? n.notebookId !== null : notebook ? n.notebookId !== notebook : false) return false;
      if (!f) return true;
      return n.title.toLowerCase().includes(f) || n.tags.some((t) => t.toLowerCase().includes(f));
    });
  }, [notes, notebook, filter]);

  const counts = useMemo(() => {
    const c = new Map<string | null, number>();
    for (const n of notes ?? []) c.set(n.notebookId, (c.get(n.notebookId) ?? 0) + 1);
    return c;
  }, [notes]);

  async function newNote() {
    const nb = notebook && notebook !== "none" ? notebook : null;
    const n = await createNote({ notebookId: nb });
    go({ name: "note", id: n.id });
  }

  async function newNotebook() {
    const name = prompt("Notebook name (e.g. Chem 0710)");
    if (!name?.trim()) return;
    const nb = await createNotebook(name);
    await reload();
    go({ name: "library", notebook: nb.id, q: "" });
  }

  async function removeNotebook(nb: NotebookRec) {
    if (!confirm(`Delete notebook "${nb.name}"? Its notes are kept (moved to Unfiled).`)) return;
    await deleteNotebook(nb.id);
    if (notebook === nb.id) go({ name: "library", notebook: null, q: "" });
    await reload();
  }

  async function onImportPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("Reading PDF…");
    try {
      const pages = await renderPdf(file, (d, t) => setBusy(`Rendering page ${d}/${t}…`));
      const nb = notebook && notebook !== "none" ? notebook : null;
      const note = await createNote({ title: file.name.replace(/\.pdf$/i, ""), notebookId: nb, paper: "blank", pageCount: pages.length });
      for (let i = 0; i < pages.length; i++) {
        setBusy(`Saving page ${i + 1}/${pages.length}…`);
        const pg = pages[i];
        const fit = Math.min(PAGE_W / pg.w, PAGE_H / pg.h); // contain within the sheet
        const w = pg.w * fit;
        const h = pg.h * fit;
        await addImage(note.id, pg.blob, { x: (PAGE_W - w) / 2, y: pageTop(i) + (PAGE_H - h) / 2, width: w, height: h, zIndex: i });
        if (pg.text) await putPageText({ key: `${note.id}:${i}:pdf`, noteId: note.id, page: i, source: "pdf", text: pg.text, hash: "pdf", updatedAt: Date.now() });
      }
      go({ name: "note", id: note.id });
    } catch (err) {
      console.error(err);
      alert("Couldn't import that PDF: " + (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function exportNotebookZip(id: string | null, name: string) {
    const list = (notes ?? []).filter((n) => (id === null ? n.notebookId === null : n.notebookId === id));
    if (!list.length) return flash(`"${name}" has no notes to export.`);
    setBusy("Preparing…");
    try {
      const loaded: { id: string; note: NonNullable<Awaited<ReturnType<typeof loadExportNote>>>["note"] }[] = [];
      const releases: (() => void)[] = [];
      for (let i = 0; i < list.length; i++) {
        setBusy(`Loading ${i + 1}/${list.length}…`);
        const l = await loadExportNote(list[i].id);
        if (l) { loaded.push({ id: list[i].id, note: l.note }); releases.push(l.release); }
      }
      await downloadNotebookZip(name, loaded, (d, t) => setBusy(`Building PDFs ${d}/${t}…`));
      releases.forEach((r) => r());
      flash("Done — check your downloads.");
    } catch (err) {
      console.error(err);
      alert("Export failed: " + (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onRestore(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setBusy("Restoring…");
    try {
      const r = await importBackups(files, setBusy);
      await reload();
      const parts = [`${r.imported} imported`];
      if (r.replaced) parts.push(`${r.replaced} updated`);
      if (r.skipped) parts.push(`${r.skipped} already up to date`);
      flash(r.errors.length ? `${parts.join(", ")} — ${r.errors[0]}` : parts.join(", "));
    } finally {
      setBusy(null);
    }
  }

  async function doBackup() {
    setBusy("Building backup…");
    try {
      const r = await backupNow();
      if (r.ok) { flash(r.how === "shared" ? "Backup saved." : "Backup downloaded — keep it somewhere safe."); setOverdue(false); }
    } catch (err) {
      alert("Backup failed: " + (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const activeName = notebook === "none" ? "Unfiled" : notebook ? notebooks.find((n) => n.id === notebook)?.name ?? "Notebook" : "All notes";

  return (
    <div className="paper-bg safe-t flex min-h-full">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface/70 px-4 py-6 backdrop-blur md:flex">
        <div className="mb-6 flex items-center gap-2"><NotebookPen size={20} className="text-primary" /><Wordmark size="sm" /></div>
        <nav className="space-y-0.5 text-sm">
          <SideItem active={!notebook} onClick={() => go({ name: "library", notebook: null, q: "" })} icon={<Folder size={15} />} label="All notes" count={notes?.length} />
          <SideItem active={notebook === "none"} onClick={() => go({ name: "library", notebook: "none", q: "" })} icon={<Folder size={15} />} label="Unfiled" count={counts.get(null)}
            action={<button title="Download as PDFs (.zip)" onClick={() => exportNotebookZip(null, "Unfiled")} className="p-1 text-foreground-muted hover:text-primary"><Download size={12} /></button>} />
          {notebooks.map((nb) => (
            <SideItem key={nb.id} active={notebook === nb.id} onClick={() => go({ name: "library", notebook: nb.id, q: "" })}
              icon={<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: nb.color }} />} label={nb.name} count={counts.get(nb.id)}
              action={<>
                <button title="Download notebook as PDFs (.zip)" onClick={() => exportNotebookZip(nb.id, nb.name)} className="p-1 text-foreground-muted hover:text-primary"><Download size={12} /></button>
                <button title="Delete notebook" onClick={() => removeNotebook(nb)} className="p-1 text-foreground-muted hover:text-negative"><Trash2 size={12} /></button>
              </>} />
          ))}
          <button onClick={newNotebook} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-foreground-muted hover:bg-surface-secondary">
            <FolderPlus size={15} /> New notebook
          </button>
        </nav>
        <div className="mt-auto space-y-0.5 pt-6 text-sm">
          <button onClick={() => go({ name: "search" })} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-foreground-muted hover:bg-surface-secondary"><Search size={15} /> Search &amp; ask</button>
          <button onClick={() => go({ name: "settings" })} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-foreground-muted hover:bg-surface-secondary"><SettingsIcon size={15} /> Settings &amp; backup</button>
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1 px-5 py-6 md:px-10">
        <div className="mx-auto max-w-6xl">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="md:hidden"><Wordmark /></div>
              <h1 className="serif hidden text-4xl tracking-tight md:block">{activeName}</h1>
              <p className="mt-1 text-sm text-foreground-muted">{visible.length} note{visible.length === 1 ? "" : "s"} · stored on this device</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by title or tag"
                  className="w-48 rounded-xl border border-border bg-surface py-2 pl-8 pr-3 text-sm outline-none focus:border-primary" />
              </div>
              <Button onClick={() => go({ name: "search" })} className="md:hidden"><Search size={15} /></Button>
              <Button onClick={() => pdfRef.current?.click()} disabled={!!busy}><FileUp size={15} /> Import PDF</Button>
              <Button variant="primary" onClick={newNote}><Plus size={15} /> New note</Button>
            </div>
          </header>

          {/* Notebook chips on narrow screens */}
          <div className="mb-4 flex gap-2 overflow-x-auto md:hidden">
            <Chip active={!notebook} onClick={() => go({ name: "library", notebook: null, q: "" })}>All</Chip>
            <Chip active={notebook === "none"} onClick={() => go({ name: "library", notebook: "none", q: "" })}>Unfiled</Chip>
            {notebooks.map((nb) => <Chip key={nb.id} active={notebook === nb.id} onClick={() => go({ name: "library", notebook: nb.id, q: "" })}>{nb.name}</Chip>)}
            <Chip onClick={newNotebook}>+ Notebook</Chip>
          </div>

          {overdue && (
            <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 border-amber-500/40 bg-amber-500/10 px-4 py-3">
              <p className="text-sm"><strong>Back up your notes.</strong> Everything lives on this device — a backup in iCloud Drive protects you if the browser ever clears its storage.</p>
              <Button onClick={doBackup} variant="primary"><Upload size={14} /> Back up now</Button>
            </Card>
          )}

          {busy && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground-muted">
              <Loader2 size={14} className="animate-spin" /> {busy}
            </div>
          )}

          {notes === null ? (
            <p className="py-20 text-center text-sm text-foreground-muted">Loading…</p>
          ) : visible.length === 0 ? (
            <Empty onNew={newNote} onPdf={() => pdfRef.current?.click()} onRestore={() => restoreRef.current?.click()} hasAny={notes.length > 0} />
          ) : (
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {visible.map((n) => (
                <NoteTile key={n.id} note={n} notebook={notebooks.find((b) => b.id === n.notebookId)} onChange={reload} flash={flash} />
              ))}
            </div>
          )}
        </div>
      </main>

      <input ref={pdfRef} type="file" accept="application/pdf" hidden onChange={onImportPdf} />
      <input ref={restoreRef} type="file" accept=".zip,application/zip" multiple hidden onChange={onRestore} />
      <Toast msg={toast} />
    </div>
  );
}

function Chip({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${active ? "border-primary bg-primary text-white" : "border-border bg-surface text-foreground-muted"}`}>
      {children}
    </button>
  );
}

function SideItem({ active, onClick, icon, label, count, action }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className={`group flex items-center rounded-lg ${active ? "bg-primary/10 font-medium text-primary" : "hover:bg-surface-secondary"}`}>
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left">
        {icon}<span className="min-w-0 flex-1 truncate">{label}</span>
        {count != null && <span className="text-xs text-foreground-muted">{count}</span>}
      </button>
      {action && <span className="flex shrink-0 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">{action}</span>}
    </div>
  );
}

function Empty({ onNew, onPdf, onRestore, hasAny }: { onNew: () => void; onPdf: () => void; onRestore: () => void; hasAny: boolean }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg px-8 py-12 text-center">
      <h2 className="serif text-3xl">{hasAny ? "Nothing here" : <>A notebook you can <span className="serif-i text-primary">live</span> in.</>}</h2>
      <p className="mt-2 text-sm text-foreground-muted">{hasAny ? "No notes match. Try another notebook or clear the filter." : "Write by hand, annotate PDFs, and keep everything on your own device."}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={onNew}><Plus size={15} /> New note</Button>
        <Button onClick={onPdf}><FileUp size={15} /> Import PDF</Button>
        {!hasAny && <Button onClick={onRestore}><Upload size={15} /> Restore backup</Button>}
      </div>
    </Card>
  );
}

function NoteTile({ note, notebook, onChange, flash }: { note: NoteMeta; notebook?: NotebookRec; onChange: () => void; flash: (m: string) => void }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    void ensureThumb(note.id).then((b) => {
      if (!alive || !b) return;
      url = URL.createObjectURL(b); // our own URL — safe to revoke on cleanup
      setThumb(url);
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [note.id, note.updatedAt]);

  async function rename() {
    const t = prompt("Rename note", note.title);
    if (t?.trim()) { await patchNote(note.id, { title: t.trim() }, false); onChange(); }
  }
  async function remove() {
    if (!confirm(`Delete "${note.title}"? This can't be undone — back up first if unsure.`)) return;
    await deleteNote(note.id);
    flash("Note deleted.");
    onChange();
  }
  async function togglePin() { await patchNote(note.id, { isPinned: !note.isPinned }, false); onChange(); }

  return (
    <div className="group">
      <div className="relative">
        <button onClick={() => go({ name: "note", id: note.id })}
          className="block aspect-[1240/1754] w-full overflow-hidden rounded-xl border border-border bg-white shadow-sm transition-shadow hover:shadow-md">
          {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover object-top" draggable={false} /> : <div className="flex h-full items-center justify-center text-xs text-foreground-muted">{note.strokeCount || note.imageCount ? "Loading preview…" : "Blank"}</div>}
        </button>
        <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
          <Mini title={note.isPinned ? "Unpin" : "Pin"} onClick={togglePin} active={note.isPinned}><Pin size={12} /></Mini>
          <Mini title="Rename" onClick={rename}><Pencil size={12} /></Mini>
          <Mini title="Delete" onClick={remove} danger><Trash2 size={12} /></Mini>
        </div>
      </div>
      <div className="mt-2 px-0.5">
        <p className="truncate text-sm font-medium">{note.title}</p>
        <p className="flex items-center gap-1.5 truncate text-xs text-foreground-muted">
          {notebook && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: notebook.color }} />}
          {note.pageCount} page{note.pageCount === 1 ? "" : "s"} · {timeAgo(note.updatedAt)}
        </p>
      </div>
    </div>
  );
}

function Mini({ children, onClick, title, active, danger }: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean; danger?: boolean }) {
  return (
    <button title={title} onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface/95 shadow-sm backdrop-blur ${active ? "text-primary" : danger ? "text-negative" : "text-foreground-muted"} hover:bg-surface-secondary`}>
      {children}
    </button>
  );
}
