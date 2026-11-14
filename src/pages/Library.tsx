import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, CheckSquare, ChevronDown, ClipboardList, Clock, Download, MoreHorizontal, RotateCcw, Trash, FileUp, Folder, FolderInput, FolderPlus, GraduationCap, Loader2, Network, NotebookPen, Pencil, Pin, Plus, Search, Settings as SettingsIcon, Tag, Trash2, Upload, X,
} from "lucide-react";
import type { NoteMeta, NotebookRec } from "@/types";
import {
  addImage, createNote, createNotebook, deleteNote, deleteNotebook, listDeletedNotes, listNotebooks, listNotes, patchNote, purgeTrash, putPageText, restoreNotes, trashNotes, TRASH_RETENTION_DAYS,
} from "@/lib/db";
import { readPdfText, renderPdf } from "@/lib/pdf";
import { PAGE_H, PAGE_W, pageTop } from "@/lib/page";
import { downloadNotebookZip } from "@/lib/export";
import { loadExportNote } from "@/lib/note-io";
import { backupIsOverdue, buildBackupZip, importBackups, shareOrDownload } from "@/lib/backup";
import { useBackupFlow } from "@/components/backup-flow";
import { ensureThumb } from "@/lib/thumbs";
import { timeAgo } from "@/lib/format";
import { getBootResult, updateSentinel, whenBooted } from "@/lib/health";
import { count, logError, timer } from "@/lib/telemetry";
import { go } from "@/router";
import { Button, Card, DropMenu, Toast, Wordmark, type DropItem } from "@/components/ui";
import { WhatsNew } from "@/components/whats-new";
import { Welcome } from "@/components/welcome";
import { InstallNudge } from "@/components/install-nudge";
import { askText, confirmBox } from "@/components/dialog";

export function Library({ notebook, q }: { notebook: string | null; q: string }) {
  const [notes, setNotes] = useState<NoteMeta[] | null>(null);
  const [trashed, setTrashed] = useState<NoteMeta[]>([]);
  const [undo, setUndo] = useState<{ label: string; onClick: () => void } | null>(null);
  const [notebooks, setNotebooks] = useState<NotebookRec[]>([]);
  const [filter, setFilter] = useState(q);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [overdue, setOverdue] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moveMenu, setMoveMenu] = useState(false);
  const [bootDismissed, setBootDismissed] = useState(false);
  // The startup checks finish a moment after first paint, so the result must be reactive —
  // otherwise a data-loss warning detected after the first render would never be shown.
  const [boot, setBoot] = useState(getBootResult());
  useEffect(() => { void whenBooted().then((b) => setBoot({ ...b })); }, []);
  const backup = useBackupFlow((m) => { flash(m); setOverdue(false); });
  const pdfRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const bookRef = useRef<HTMLInputElement>(null);
  const examRef = useRef<HTMLInputElement>(null);
  /** textbooks just imported on this device, packed as a small file to move to another device */
  const [pack, setPack] = useState<{ file: File; names: string[] } | null>(null);

  const reload = useCallback(async () => {
    await purgeTrash().catch(() => 0);
    const [n, nb, tr] = await Promise.all([listNotes(), listNotebooks(), listDeletedNotes()]);
    setNotes(n);
    setTrashed(tr);
    updateSentinel(n.length); // a copy of the note count outside IndexedDB, to detect a wiped database
    setNotebooks(nb);
    setOverdue(await backupIsOverdue());
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const flash = (m: string) => { setToast(m); setUndo(null); setTimeout(() => setToast((t) => (t === m ? null : t)), 3200); };
  /** Deleting is never a dead end: the toast offers Undo, and the notes wait in "Recently deleted". */
  const flashUndo = (m: string, ids: string[]) => {
    setToast(m); setUndo({ label: "Undo", onClick: () => { void restoreNotes(ids).then(reload); setToast(null); setUndo(null); } });
    setTimeout(() => setToast((t) => (t === m ? null : t)), 7000);
  };
  useEffect(() => {
    // a note trashed from inside the editor: offer Undo here
    try {
      const raw = sessionStorage.getItem("pipit.trashed");
      if (raw) { sessionStorage.removeItem("pipit.trashed"); const t = JSON.parse(raw) as { ids: string[]; title: string }; flashUndo(`“${t.title}” moved to Recently deleted.`, t.ids); }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (notebook === "trash") return trashed;
    if (notebook === "recent") {
      return (notes ?? []).filter((n) => n.openedAt).sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0)).slice(0, 16);
    }
    return (notes ?? []).filter((n) => {
      if (notebook === "none" ? n.notebookId !== null : notebook ? n.notebookId !== notebook : false) return false;
      if (tagFilter && !n.tags.includes(tagFilter)) return false;
      if (!f) return true;
      return n.title.toLowerCase().includes(f) || n.tags.some((t) => t.toLowerCase().includes(f));
    });
  }, [notes, trashed, notebook, filter, tagFilter]);

  const allTags = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of notes ?? []) for (const t of n.tags) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [notes]);

  const counts = useMemo(() => {
    const c = new Map<string | null, number>();
    for (const n of notes ?? []) c.set(n.notebookId, (c.get(n.notebookId) ?? 0) + 1);
    return c;
  }, [notes]);

  async function newNote() {
    count("library.newNote");
    const nb = notebook && notebook !== "none" && notebook !== "recent" ? notebook : null;
    const n = await createNote({ notebookId: nb });
    go({ name: "note", id: n.id });
  }

  async function newNotebook() {
    const name = await askText("New notebook", { placeholder: "e.g. Chem 0710", ok: "Create" });
    if (!name?.trim()) return;
    const nb = await createNotebook(name);
    await reload();
    go({ name: "library", notebook: nb.id, q: "" });
  }

  async function removeNotebook(nb: NotebookRec) {
    if (!(await confirmBox(`Delete notebook "${nb.name}"?`, { body: "Its notes are kept and moved to Unfiled.", ok: "Delete notebook", danger: true }))) return;
    await deleteNotebook(nb.id);
    if (notebook === nb.id) go({ name: "library", notebook: null, q: "" });
    await reload();
  }

  async function importOnePdf(file: File, label: string): Promise<string> {
    const pages = await renderPdf(file, (d, t) => setBusy(`${label}Rendering page ${d}/${t}…`));
    const nb = notebook && notebook !== "none" && notebook !== "recent" ? notebook : null;
    const note = await createNote({ title: file.name.replace(/\.pdf$/i, ""), notebookId: nb, paper: "blank", pageCount: pages.length });
    for (let i = 0; i < pages.length; i++) {
      setBusy(`${label}Saving page ${i + 1}/${pages.length}…`);
      const pg = pages[i];
      const fit = Math.min(PAGE_W / pg.w, PAGE_H / pg.h); // contain within the sheet
      const w = pg.w * fit;
      const h = pg.h * fit;
      await addImage(note.id, pg.blob, { x: (PAGE_W - w) / 2, y: pageTop(i) + (PAGE_H - h) / 2, width: w, height: h, zIndex: i });
      if (pg.text) await putPageText({ key: `${note.id}:${i}:pdf`, noteId: note.id, page: i, source: "pdf", text: pg.text, hash: "pdf", updatedAt: Date.now(), boxes: pg.boxes });
    }
    return note.id;
  }

  /** One or many PDFs (e.g. a stack of Canva packets): each becomes its own note, filed in the open notebook. */
  async function onImportPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
    e.target.value = "";
    if (!files.length) return;
    count("library.importPdf");
    if (files.length > 1) count("library.importPdf.batch");
    const made: string[] = [];
    const failed: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const label = files.length > 1 ? `${i + 1}/${files.length} “${files[i].name.replace(/\.pdf$/i, "").slice(0, 28)}” · ` : "";
        setBusy(`${label}Reading PDF…`);
        try {
          made.push(await importOnePdf(files[i], label));
        } catch (err) {
          logError("pdf-import", err, { bytes: files[i].size });
          failed.push(`${files[i].name}: ${(err as Error).message}`);
        }
      }
    } finally {
      setBusy(null);
    }
    if (made.length === 1 && !failed.length) return go({ name: "note", id: made[0] });
    await reload();
    flash(`Imported ${made.length} PDF${made.length === 1 ? "" : "s"}${failed.length ? ` · ${failed.length} failed` : ""}.`);
    if (failed.length) alert("Couldn't import:\n" + failed.join("\n"));
  }

  /**
   * Textbooks are imported as TEXT ONLY (no page pictures): fast, tiny, no page limit. The same button takes a
   * textbook pack (.zip) made on another device, so a book can be imported on a laptop and moved to the iPad
   * as a file of a few MB instead of downloading the whole PDF there.
   */
  async function onImportTextbooks(e: React.ChangeEvent<HTMLInputElement>, kind: "textbook" | "exam" = "textbook") {
    const what = kind === "exam" ? "past exam" : "textbook";
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    const packs = files.filter((f) => /\.zip$/i.test(f.name) || /zip/i.test(f.type));
    const pdfs = files.filter((f) => !packs.includes(f) && (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)));
    const made: string[] = [];
    const names: string[] = [];
    const notes: string[] = [];
    try {
      if (packs.length) {
        count("library.textbookPack.import");
        const r = await importBackups(packs, setBusy);
        notes.push(r.errors.length ? `Couldn't read ${r.errors[0]}` : `${r.imported + r.replaced} textbook${r.imported + r.replaced === 1 ? "" : "s"} added from the file${r.skipped ? ` (${r.skipped} already here)` : ""}.`);
      }
      for (let i = 0; i < pdfs.length; i++) {
        const f = pdfs[i];
        const label = pdfs.length > 1 ? `${i + 1}/${pdfs.length} ` : "";
        try {
          const pages = await readPdfText(f, (d, t) => setBusy(`${label}Reading “${f.name.replace(/\.pdf$/i, "").slice(0, 30)}” — page ${d}/${t}…`));
          const readable = pages.filter((t) => t.length > 40).length;
          if (readable < (kind === "exam" ? 1 : Math.max(3, pages.length * 0.2))) { notes.push(`“${f.name}” looks like a scan (no text layer), so it can't be used as a ${what}.`); continue; }
          const nb = notebook && notebook !== "none" && notebook !== "recent" && notebook !== "trash" ? notebook : null;
          const note = await createNote({ title: f.name.replace(/\.pdf$/i, ""), notebookId: nb, paper: "blank", pageCount: Math.max(1, pages.length) });
          for (let k = 0; k < pages.length; k++) if (pages[k]) await putPageText({ key: `${note.id}:${k}:pdf`, noteId: note.id, page: k, source: "pdf", text: pages[k], hash: "pdf", updatedAt: Date.now(), boxes: [] });
          await patchNote(note.id, kind === "exam" ? { isPastExam: true } : { isTextbook: true }, false);
          made.push(note.id); names.push(note.title);
        } catch (err) {
          logError("textbook-import", err, { bytes: f.size });
          notes.push(`Couldn't read “${f.name}”: ${(err as Error).message}`);
        }
      }
      if (made.length) {
        count(kind === "exam" ? "library.pastExam.import" : "library.textbook.import");
        if (matchMedia("(pointer: fine)").matches) {   // a laptop/desktop: get the file ready to move to the iPad
          setBusy("Packing a copy for your other devices…");
          const zip = await buildBackupZip(made);
          setPack({ file: new File([zip.slice()], `${kind === "exam" ? "Past exams" : "Textbooks"} ${new Date().toISOString().slice(0, 10)}.zip`, { type: "application/zip" }), names });
        }
      }
    } finally { setBusy(null); }
    await reload();
    if (made.length) notes.unshift(kind === "exam"
      ? `Added ${made.length} past exam${made.length === 1 ? "" : "s"}. Practice exams can now copy ${made.length === 1 ? "its" : "their"} format (Study → Exams → “Match my course's past exams”).`
      : `Added ${made.length} textbook${made.length === 1 ? "" : "s"} — practice exams can now use ${made.length === 1 ? "its" : "their"} problems.`);
    if (notes.length) flash(notes.join(" "));
  }

  // --- multi-select -------------------------------------------------------------------------
  const togglePick = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const stopSelecting = () => { setSelecting(false); setPicked(new Set()); setMoveMenu(false); };
  async function moveSelected(nbId: string | null) {
    setMoveMenu(false);
    for (const id of picked) await patchNote(id, { notebookId: nbId }, false);
    count("library.bulkMove");
    flash(`Moved ${picked.size} note${picked.size === 1 ? "" : "s"}.`);
    stopSelecting();
    await reload();
  }
  async function tagSelected() {
    const t = (await askText("Add tags to the selected notes", { label: "Separate tags with commas", placeholder: "e.g. exam, week 3", ok: "Add" }))?.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!t?.length) return;
    for (const id of picked) {
      const n = (notes ?? []).find((x) => x.id === id);
      if (n) await patchNote(id, { tags: [...new Set([...n.tags, ...t])] }, false);
    }
    count("library.bulkTag");
    stopSelecting();
    await reload();
  }
  async function deleteSelected() {
    const ids = [...picked];
    await trashNotes(ids);
    count("library.bulkDelete");
    stopSelecting();
    await reload();
    flashUndo(`${ids.length} note${ids.length === 1 ? "" : "s"} moved to Recently deleted.`, ids);
  }
  async function exportSelected() {
    const list = (notes ?? []).filter((n) => picked.has(n.id));
    if (!list.length) return;
    await exportList(list, "Selected notes");
    stopSelecting();
  }

  async function exportNotebookZip(id: string | null, name: string) {
    const list = (notes ?? []).filter((n) => (id === null ? n.notebookId === null : n.notebookId === id));
    if (!list.length) return flash(`"${name}" has no notes to export.`);
    await exportList(list, name);
  }
  async function exportList(list: NoteMeta[], name: string) {
    setBusy("Preparing…");
    count("export.zip");
    const stopZip = timer("export.zip.ms");
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
      stopZip();
      flash("Done — check your downloads.");
    } catch (err) {
      logError("export", err, { kind: "notebook-zip", notes: list.length });
      alert("Export failed: " + (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onRestore(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    count("library.restore");
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

  const importItems: DropItem[] = [
    { icon: <FileUp size={17} />, label: "PDF to write on", hint: "Slides or a worksheet. Each PDF becomes a note.", onClick: () => pdfRef.current?.click() },
    { icon: <BookOpen size={17} />, label: "Textbook", hint: "Text only. Practice exams can use its problems.", onClick: () => bookRef.current?.click() },
    { icon: <ClipboardList size={17} />, label: "Past exam", hint: "Practice exams copy its format, never its questions.", onClick: () => examRef.current?.click() },
    { divider: true, icon: <Upload size={17} />, label: "Restore a backup", hint: "A .zip saved with Back up now.", onClick: () => restoreRef.current?.click() },
  ];

  const activeName = notebook === "trash" ? "Recently deleted" : notebook === "recent" ? "Recent" : notebook === "none" ? "Unfiled" : notebook ? notebooks.find((n) => n.id === notebook)?.name ?? "Notebook" : "All notes";

  return (
    <div className="paper-bg safe-t flex min-h-full">
      {/* Sidebar */}
      <aside className="sticky top-[env(safe-area-inset-top,0px)] hidden h-[calc(100dvh-env(safe-area-inset-top,0px))] w-56 shrink-0 flex-col self-start overflow-y-auto overscroll-contain border-r border-border bg-surface/70 px-3.5 py-6 backdrop-blur md:flex lg:w-60 lg:px-4">
        <div className="mb-6 flex items-center gap-2"><NotebookPen size={20} className="text-primary" /><Wordmark size="sm" /></div>
        <nav className="space-y-0.5 text-sm">
          <SideItem active={!notebook} onClick={() => go({ name: "library", notebook: null, q: "" })} icon={<Folder size={15} />} label="All notes" count={notes?.length} />
          <SideItem active={notebook === "recent"} onClick={() => go({ name: "library", notebook: "recent", q: "" })} icon={<Clock size={15} />} label="Recent" />
          {(trashed.length > 0 || notebook === "trash") && <SideItem active={notebook === "trash"} onClick={() => go({ name: "library", notebook: "trash", q: "" })} icon={<Trash size={15} />} label="Recently deleted" count={trashed.length} />}
          <SideItem active={notebook === "none"} onClick={() => go({ name: "library", notebook: "none", q: "" })} icon={<Folder size={15} />} label="Unfiled" count={counts.get(null)}
            action={<button title="Download as PDFs (.zip)" aria-label="Download Unfiled as PDFs" onClick={() => exportNotebookZip(null, "Unfiled")} className={sideAction}><Download size={13} /></button>} />
          {notebooks.map((nb) => (
            <SideItem key={nb.id} active={notebook === nb.id} onClick={() => go({ name: "library", notebook: nb.id, q: "" })}
              icon={<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: nb.color }} />} label={nb.name} count={counts.get(nb.id)}
              action={<>
                <button title="Download notebook as PDFs (.zip)" aria-label={`Download ${nb.name} as PDFs`} onClick={() => exportNotebookZip(nb.id, nb.name)} className={sideAction}><Download size={13} /></button>
                <button title="Delete notebook" aria-label={`Delete notebook ${nb.name}`} onClick={() => removeNotebook(nb)} className={`${sideAction} hover:text-negative`}><Trash2 size={13} /></button>
              </>} />
          ))}
          <button onClick={newNotebook} className={`mt-1 ${sideLink} text-foreground-muted hover:bg-surface-secondary`}>
            <FolderPlus size={15} /> New notebook
          </button>
        </nav>
        <div className="mt-auto space-y-0.5 pt-6 text-sm">
          <button onClick={() => go({ name: "study" })} className={`${sideLink} bg-primary/10 font-medium text-primary hover:bg-primary/20`}><GraduationCap size={15} /> Study</button>
          <button onClick={() => go({ name: "search" })} className={`${sideLink} text-foreground-muted hover:bg-surface-secondary`}><Search size={15} /> Search &amp; ask</button>
          <button onClick={() => go({ name: "graph" })} className={`${sideLink} text-foreground-muted hover:bg-surface-secondary`}><Network size={15} /> Concept maps</button>
          <button onClick={() => go({ name: "settings" })} className={`${sideLink} text-foreground-muted hover:bg-surface-secondary`}><SettingsIcon size={15} /> Settings &amp; backup</button>
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-5 md:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <div className="md:hidden"><Wordmark /></div>
              <h1 className="serif hidden text-4xl tracking-tight [overflow-wrap:anywhere] md:block">{activeName}</h1>
              <p className="mt-1 text-sm text-foreground-muted">{notebook === "trash" ? `Removed for good after ${TRASH_RETENTION_DAYS} days. Restore anything you want to keep.` : `${visible.length} note${visible.length === 1 ? "" : "s"} · stored on this device`}</p>
            </div>
            {/* one row at iPad width: the filter takes what is left, the three actions keep their size */}
            <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto">
              <div className="relative min-w-28 flex-1 xl:w-52 xl:flex-none">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter notes" aria-label="Filter notes by title or tag" enterKeyHint="search"
                  className="w-full rounded-xl border border-border bg-surface py-2 pl-8 pr-3 text-sm outline-none focus:border-primary [@media(pointer:coarse)]:min-h-11" />
              </div>
              <Button onClick={() => go({ name: "search" })} className="shrink-0 md:hidden" ariaLabel="Search inside notes" title="Search inside notes"><Search size={15} /></Button>
              <Button onClick={() => (selecting ? stopSelecting() : setSelecting(true))} className="shrink-0" title="Select several notes to move, tag, export or delete"><CheckSquare size={15} /> {selecting ? "Cancel" : "Select"}</Button>
              <DropMenu label="Import" title="Bring in PDFs, textbooks, past exams or a backup" disabled={!!busy} items={importItems}><FileUp size={15} /> Import <ChevronDown size={14} className="-mr-1 text-foreground-muted" /></DropMenu>
              <Button variant="primary" onClick={newNote} className="shrink-0"><Plus size={15} /> New note</Button>
            </div>
          </header>

          {/* Notebook chips on narrow screens */}
          <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5 md:hidden">
            <Chip active={!notebook} onClick={() => go({ name: "library", notebook: null, q: "" })}>All</Chip>
            <Chip active={notebook === "none"} onClick={() => go({ name: "library", notebook: "none", q: "" })}>Unfiled</Chip>
            {notebooks.map((nb) => <Chip key={nb.id} active={notebook === nb.id} onClick={() => go({ name: "library", notebook: nb.id, q: "" })}>{nb.name}</Chip>)}
            <Chip onClick={newNotebook}>+ Notebook</Chip>
            <Chip active={notebook === "recent"} onClick={() => go({ name: "library", notebook: "recent", q: "" })}>Recent</Chip>
            <Chip onClick={() => go({ name: "study" })}>Study</Chip>
            <Chip onClick={() => go({ name: "graph" })}>Maps</Chip>
            {(trashed.length > 0 || notebook === "trash") && <Chip active={notebook === "trash"} onClick={() => go({ name: "library", notebook: "trash", q: "" })}>Recently deleted</Chip>}
            <Chip onClick={() => go({ name: "settings" })}>Settings</Chip>
          </div>

          {allTags.length > 0 && notebook !== "recent" && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <Tag size={13} className="text-foreground-muted" />
              {allTags.map((t) => (
                <button key={t} onClick={() => setTagFilter(tagFilter === t ? null : t)}
                  aria-pressed={tagFilter === t} className={`rounded-full border px-2.5 py-0.5 text-xs [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:px-3 [@media(pointer:coarse)]:text-sm ${tagFilter === t ? "border-primary bg-primary text-white" : "border-border bg-surface text-foreground-muted hover:bg-surface-secondary"}`}>#{t}</button>
              ))}
            </div>
          )}

          {boot.evicted && !bootDismissed && (
            <Card className="mb-5 border-negative/50 bg-negative/10 px-4 py-3">
              <p className="text-sm"><strong>Your notes were cleared from this device.</strong> The browser wiped this app&apos;s storage{boot.notesBefore ? ` (you had ${boot.notesBefore} note${boot.notesBefore === 1 ? "" : "s"})` : ""}. Restore from your latest backup: Settings → Restore from backup. To prevent this, add the app to your Home Screen and keep backing up.</p>
              <div className="mt-2 flex gap-2"><Button variant="primary" onClick={() => go({ name: "settings" })}>Open Settings</Button><Button onClick={() => setBootDismissed(true)}>Dismiss</Button></div>
            </Card>
          )}
          {boot.uncleanExit && !boot.evicted && !bootDismissed && (
            <Card className="mb-5 border-amber-500/40 bg-amber-500/10 px-4 py-3">
              <p className="text-sm"><strong>The app closed unexpectedly last time</strong> and some of your latest writing may not have been saved. Check the note you were working on. (A problem report was logged.)</p>
              <div className="mt-2"><Button onClick={() => setBootDismissed(true)}>Got it</Button></div>
            </Card>
          )}
          {notes !== null && notes.length > 0 && <InstallNudge />}
          {overdue && (
            <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 border-amber-500/40 bg-amber-500/10 px-4 py-3">
              <p className="text-sm"><strong>Back up your notes.</strong> Everything lives on this device — a backup in iCloud Drive protects you if the browser ever clears its storage.</p>
              <Button onClick={backup.start} disabled={backup.building} variant="primary">{backup.building ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {backup.building ? "Building…" : "Back up now"}</Button>
            </Card>
          )}

          {pack && (
            <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 border-primary/40 bg-primary/5 px-4 py-3">
              <p className="min-w-0 flex-1 text-sm"><strong>Move {pack.names.length === 1 ? `“${pack.names[0]}”` : `these ${pack.names.length} files`} to your iPad:</strong> save this small file ({Math.max(0.1, pack.file.size / 1e6).toFixed(1)} MB, text only) to iCloud Drive, OneDrive or Google Drive, or email it to yourself. Then on the iPad tap <b>Import</b>, choose <b>Textbook</b> (or <b>Past exam</b>) and pick it.</p>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => void shareOrDownload(pack.file, "Textbooks")}><Download size={14} /> Save file</Button>
                <Button onClick={() => setPack(null)}>Done</Button>
              </div>
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
            <>
              <Empty onNew={newNote} onPdf={() => pdfRef.current?.click()} onRestore={() => restoreRef.current?.click()} hasAny={notes.length > 0} />
              {notes.length === 0 && <Welcome />}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4">
              {visible.map((n) => (
                <NoteTile key={n.id} note={n} notebook={notebooks.find((b) => b.id === n.notebookId)} notebooks={notebooks} onChange={reload} flash={flash} selecting={selecting} picked={picked.has(n.id)} onPick={() => togglePick(n.id)}
                  trashed={notebook === "trash"} onTrash={async () => { await trashNotes([n.id]); await reload(); flashUndo(`“${n.title}” moved to Recently deleted.`, [n.id]); }}
                  onRestore={async () => { await restoreNotes([n.id]); await reload(); flash("Restored."); }}
                  onPurge={async () => { if (await confirmBox(`Permanently delete "${n.title}"?`, { body: "This can't be undone.", ok: "Delete for good", danger: true })) { await deleteNote(n.id); await reload(); flash("Deleted for good."); } }} />
              ))}
            </div>
          )}
        </div>
      </main>

      <input ref={pdfRef} type="file" accept="application/pdf" multiple hidden onChange={onImportPdf} />
      <input ref={bookRef} type="file" accept="application/pdf,.pdf,.zip,application/zip" multiple hidden onChange={(e) => void onImportTextbooks(e)} />
      <input ref={examRef} type="file" accept="application/pdf,.pdf,.zip,application/zip" multiple hidden onChange={(e) => void onImportTextbooks(e, "exam")} />
      <input ref={restoreRef} type="file" accept=".zip,application/zip" multiple hidden onChange={onRestore} />
      {selecting && (
        <div className="safe-b fixed inset-x-0 bottom-4 z-40 flex justify-center px-3">
          <div className="anim-rise relative flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-border bg-surface px-3 py-2 shadow-2xl">
            <span className="mr-1 text-sm font-medium tabular-nums">{picked.size} selected</span>
            <Button variant="ghost" onClick={() => setPicked(new Set(visible.map((n) => n.id)))}>All</Button>
            <Button disabled={!picked.size} onClick={() => setMoveMenu((v) => !v)}><FolderInput size={14} /> Move</Button>
            <Button disabled={!picked.size} onClick={tagSelected}><Tag size={14} /> Tag</Button>
            <Button disabled={!picked.size} onClick={exportSelected}><Download size={14} /> PDFs</Button>
            <Button variant="danger" disabled={!picked.size} onClick={deleteSelected}><Trash2 size={14} /> Delete</Button>
            <button onClick={stopSelecting} className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-muted hover:bg-surface-secondary [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" title="Done selecting" aria-label="Done selecting"><X size={16} /></button>
            {moveMenu && (
              <div className="anim-pop absolute bottom-full left-0 mb-2 max-h-60 w-56 origin-bottom-left overflow-auto overscroll-contain rounded-xl border border-border bg-surface p-1 text-sm shadow-xl">
                {[{ id: null as string | null, name: "Unfiled", color: "" }, ...notebooks].map((b) => (
                  <button key={b.id ?? "none"} onClick={() => moveSelected(b.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-secondary [@media(pointer:coarse)]:min-h-11">
                    {b.color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} /> : <span className="h-2 w-2" />}
                    <span className="truncate">{b.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {notes && <WhatsNew hasNotes={notes.length > 0} />}
      {backup.modal}
      <Toast msg={toast} action={undo} />
    </div>
  );
}

/** sidebar rows and the small actions inside them: comfortable to hit with a finger, compact with a mouse */
const sideLink = "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left [@media(pointer:coarse)]:min-h-11";
const sideAction = "flex items-center justify-center rounded-md p-1 text-foreground-muted hover:text-primary [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-8";

function Chip({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={`max-w-[14rem] shrink-0 truncate rounded-full border px-3 py-1.5 text-sm [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:px-3.5 ${active ? "border-primary bg-primary text-white" : "border-border bg-surface text-foreground-muted"}`}>
      {children}
    </button>
  );
}

function SideItem({ active, onClick, icon, label, count, action }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className={`group flex items-center rounded-lg ${active ? "bg-primary/10 font-medium text-primary" : "hover:bg-surface-secondary"}`}>
      <button onClick={onClick} aria-current={active ? "page" : undefined} title={label} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left [@media(pointer:coarse)]:min-h-11">
        <span className="flex w-[15px] shrink-0 justify-center">{icon}</span><span className="min-w-0 flex-1 truncate">{label}</span>
        {count != null && <span className="text-xs tabular-nums text-foreground-muted">{count}</span>}
      </button>
      {action && <span className="flex shrink-0 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">{action}</span>}
    </div>
  );
}

function Empty({ onNew, onPdf, onRestore, hasAny }: { onNew: () => void; onPdf: () => void; onRestore: () => void; hasAny: boolean }) {
  return (
    <Card className="mx-auto mt-6 max-w-lg px-6 py-10 text-center sm:px-8 md:mt-10">
      <h2 className="serif text-3xl">{hasAny ? "Nothing here" : <>A notebook you can <span className="serif-i text-primary">live</span> in.</>}</h2>
      <p className="mt-2 text-sm text-foreground-muted">{hasAny ? "No notes match. Try another notebook or clear the filter." : "Write by hand, annotate PDFs, and keep everything on your own device."}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={onNew}><Plus size={15} /> New note</Button>
        <Button onClick={onPdf}><FileUp size={15} /> Import PDF</Button>
      </div>
      {!hasAny && <button type="button" onClick={onRestore} className="tap mt-3 rounded-lg px-2 text-sm text-foreground-muted underline decoration-dotted underline-offset-4 hover:text-foreground">Moving from another device? Restore a backup</button>}
    </Card>
  );
}

function NoteTile({ note, notebook, notebooks, onChange, flash, selecting, picked, onPick, trashed, onTrash, onRestore, onPurge }: { note: NoteMeta; notebook?: NotebookRec; notebooks: NotebookRec[]; onChange: () => void; flash: (m: string) => void; selecting: boolean; picked: boolean; onPick: () => void; trashed: boolean; onTrash: () => void; onRestore: () => void; onPurge: () => void }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const reference = !!note.isTextbook || !!note.isPastExam;
  const textOnly = reference && !note.imageCount && !note.strokeCount;
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    if (reference && !note.imageCount && !note.strokeCount) return;
    void ensureThumb(note.id).then((b) => {
      if (!alive || !b) return;
      url = URL.createObjectURL(b); // our own URL — safe to revoke on cleanup
      setThumb(url);
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [note.id, note.updatedAt]);

  async function rename() {
    const t = await askText("Rename note", { value: note.title, ok: "Rename" });
    if (t?.trim()) { await patchNote(note.id, { title: t.trim() }, false); onChange(); }
  }
  void flash;
  const [moving, setMoving] = useState(false);
  async function moveTo(id: string | null) { setMoving(false); if (id !== note.notebookId) { await patchNote(note.id, { notebookId: id }, false); flash(id ? "Moved to notebook." : "Moved to Unfiled."); onChange(); } }
  async function editTags() {
    const t = await askText("Tags", { label: "Separate tags with commas", value: note.tags.join(", "), ok: "Save" });
    if (t === null) return;
    await patchNote(note.id, { tags: [...new Set(t.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))] }, false);
    onChange();
  }
  async function togglePin() { await patchNote(note.id, { isPinned: !note.isPinned }, false); onChange(); }
  async function toggleTextbook() {
    await patchNote(note.id, { isTextbook: !note.isTextbook || undefined, isPastExam: undefined }, false);
    flash(note.isTextbook ? "Back to being one of your notes." : "Marked as a textbook — practice exams can use its problems, limited to what your notes cover. It's left out of flashcards.");
    onChange();
  }
  async function togglePastExam() {
    await patchNote(note.id, { isPastExam: !note.isPastExam || undefined, isTextbook: undefined }, false);
    flash(note.isPastExam ? "Back to being one of your notes." : "Marked as a past exam: practice exams can copy its format (never its questions). It's left out of flashcards.");
    onChange();
  }

  // with a mouse the tile's buttons appear on hover (or keyboard focus); on touch they are always there
  const reveal = "opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100";
  return (
    <div className="group relative">
      <div className="relative">
        <button onClick={() => (selecting ? onPick() : textOnly ? flash(note.isPastExam ? `“${note.title}” is a text-only past exam. Practice exams copy its format — there's nothing to write on.` : `“${note.title}” is a text-only textbook (${note.pageCount} pages). Practice exams use its problems — there's nothing to write on.`) : go({ name: "note", id: note.id }))}
          className={`block aspect-[1240/1754] w-full overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md ${picked ? "border-primary ring-4 ring-primary/40" : "border-border"}`}>
          {textOnly ? <div className="flex h-full flex-col items-center justify-center gap-2 bg-primary/5 px-3 text-center text-xs text-primary">{note.isPastExam ? <ClipboardList size={28} /> : <BookOpen size={28} />}<span>{note.isPastExam ? "Past exam" : "Textbook"} · text only</span></div> : thumb ? <img src={thumb} alt="" className="h-full w-full object-cover object-top" draggable={false} /> : <div className="flex h-full items-center justify-center text-xs text-foreground-muted">{note.strokeCount || note.imageCount ? "Loading preview…" : "Blank"}</div>}
        </button>
        {selecting && <span className={`pointer-events-none absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 text-white ${picked ? "border-primary bg-primary" : "border-white bg-black/30"}`}>{picked ? "✓" : ""}</span>}
        {trashed ? (
          <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between gap-1">
            <button onClick={onRestore} className="flex min-h-9 min-w-0 flex-1 items-center [@media(pointer:coarse)]:min-h-11 justify-center gap-1 rounded-lg bg-surface/95 px-2 text-xs font-medium text-primary shadow backdrop-blur"><RotateCcw size={13} /> Restore</button>
            <button onClick={onPurge} className="flex min-h-9 items-center justify-center rounded-lg bg-surface/95 px-2.5 text-negative shadow backdrop-blur [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3.5" title="Delete for good" aria-label={`Delete ${note.title} for good`}><Trash2 size={13} /></button>
          </div>
        ) : (
          <>
            <div className={`absolute right-1.5 top-1.5 ${reveal} ${selecting ? "hidden" : ""}`}>
              <DropMenu label={`Actions for ${note.title}`} title="Pin, move, tag, rename" width={248} triggerClass={miniClass} items={[
                { icon: <Pin size={16} />, label: note.isPinned ? "Unpin" : "Pin to the top", active: note.isPinned, onClick: () => void togglePin() },
                { icon: <FolderInput size={16} />, label: "Move to notebook", onClick: () => setMoving(true) },
                { icon: <Tag size={16} />, label: note.tags.length ? "Edit tags" : "Add tags", onClick: () => void editTags() },
                { icon: <Pencil size={16} />, label: "Rename", onClick: () => void rename() },
                { divider: true, icon: <BookOpen size={16} />, label: note.isTextbook ? "Textbook: make it a normal note" : "Mark as a textbook", hint: note.isTextbook ? undefined : "Practice exams can use its problems", active: note.isTextbook, onClick: () => void toggleTextbook() },
                { icon: <ClipboardList size={16} />, label: note.isPastExam ? "Past exam: make it a normal note" : "Mark as a past exam", hint: note.isPastExam ? undefined : "Practice exams copy its format", active: note.isPastExam, onClick: () => void togglePastExam() },
              ]}><MoreHorizontal size={16} /></DropMenu>
            </div>
            {/* the destructive action lives in its own corner, far from the buttons used all the time */}
            <div className={`absolute bottom-1.5 right-1.5 ${reveal} ${selecting ? "hidden" : ""}`}>
              <Mini title="Move to Recently deleted" onClick={onTrash} danger><Trash2 size={13} /></Mini>
            </div>
          </>
        )}
      </div>
      {moving && (
        <>
        <div className="fixed inset-0 z-10" onClick={() => setMoving(false)} />
        <div className="anim-pop absolute inset-x-1.5 top-1.5 z-20 max-h-64 origin-top overflow-auto overscroll-contain rounded-xl border border-border bg-surface p-1 text-sm shadow-xl">
          <p className="px-2 py-1 text-xs text-foreground-muted">Move “{note.title.length > 24 ? `${note.title.slice(0, 24)}…` : note.title}” to</p>
          {[{ id: null as string | null, name: "Unfiled", color: "" }, ...notebooks].map((b) => (
            <button key={b.id ?? "none"} onClick={() => moveTo(b.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-secondary [@media(pointer:coarse)]:min-h-11 ${b.id === note.notebookId ? "font-semibold text-primary" : ""}`}>
              {b.color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} /> : <span className="h-2 w-2 shrink-0" />}
              <span className="truncate">{b.name}</span>
            </button>
          ))}
        </div>
        </>
      )}
      <div className="mt-2 px-0.5">
        <p className="flex items-center gap-1 text-sm font-medium" title={note.title}>
          {note.isPinned && <Pin size={12} className="shrink-0 text-primary" aria-label="Pinned" />}
          <span className="truncate">{note.title}</span>
        </p>
        <p className="flex items-center gap-1.5 truncate text-xs text-foreground-muted">
          {notebook && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: notebook.color }} />}
          {note.isTextbook && <span className="font-medium text-primary">Textbook ·</span>}
          {note.isPastExam && <span className="font-medium text-primary">Past exam ·</span>}
          {note.pageCount} page{note.pageCount === 1 ? "" : "s"} · {timeAgo(note.updatedAt)}
        </p>
        {note.tags.length > 0 && <p className="mt-0.5 truncate text-[11px] text-primary/80">{note.tags.map((t) => `#${t}`).join(" ")}</p>}
      </div>
    </div>
  );
}

const miniClass = "flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface/95 text-foreground-muted shadow-sm backdrop-blur hover:bg-surface-secondary [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11";

function Mini({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={`${miniClass} ${danger ? "!text-negative" : ""}`}>
      {children}
    </button>
  );
}
