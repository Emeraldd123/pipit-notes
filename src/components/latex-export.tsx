// "Save as LaTeX": read the pages into structured content, let you check each diagram (redrawn or your own
// drawing), then save a .zip (main.tex + figures/) that Overleaf opens as a project.
import { useRef, useState } from "react";
import { strToU8, zipSync } from "fflate";
import { FileCode2, Loader2 } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { readPageForLatex, AiError } from "@/lib/ai";
import { blockToElement, buildLatexDoc, figurePath, type El, type FigureChoice, type LatexPage } from "@/lib/latex-doc";
import { estimateUsd, formatUsd } from "@/lib/ai-cost";
import { shareOrDownload } from "@/lib/backup";
import { safeName } from "@/lib/export";
import { PAGE_GAP, PAGE_H, PAGE_W, pageTop } from "@/lib/page";
import { getSettings } from "@/lib/settings";
import { count, logError } from "@/lib/telemetry";
import type { BlockRec } from "@/types";

type Fig = Extract<El, { t: "figure" }> & { image: string | null };

const KIND_LABEL: Record<string, string> = { plot: "graph", chart: "chart", flow: "flowchart", circuit: "circuit diagram" };

function dataUrlBytes(url: string): Uint8Array {
  const b = atob(url.slice(url.indexOf(",") + 1));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export function LatexExport({ title, pageCount, currentPage, inkPages, printPages, blocks, pageImage, regionImage, onClose, onDone }: {
  title: string; pageCount: number; currentPage: number;
  /** pages with handwriting / with an imported (printed) page under them */
  inkPages: boolean[]; printPages: boolean[];
  blocks: BlockRec[];
  pageImage: (p: number) => string | null;
  regionImage: (r: { x: number; y: number; w: number; h: number }) => string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [scope, setScope] = useState<"all" | "page">("all");
  const [inkOnly, setInkOnly] = useState(false);
  const [phase, setPhase] = useState<"setup" | "reading" | "review">("setup");
  const [progress, setProgress] = useState("");
  const [pages, setPages] = useState<LatexPage[]>([]);
  const [figs, setFigs] = useState<Fig[]>([]);
  const [choice, setChoice] = useState<Record<string, FigureChoice>>({});
  const [failed, setFailed] = useState<number[]>([]);
  const cancelled = useRef(false);

  const chosen = (scope === "all" ? Array.from({ length: pageCount }, (_, i) => i) : [currentPage]);
  const needsAi = (p: number) => inkPages[p] || (!inkOnly && printPages[p]);
  const aiPages = chosen.filter(needsAi);
  const blocksOn = (p: number) => blocks.filter((b) => Math.floor((b.y + 20) / (PAGE_H + PAGE_GAP)) === p);
  const exportable = chosen.filter((p) => needsAi(p) || blocksOn(p).length);
  const cost = formatUsd(estimateUsd("latex", aiPages.length, getSettings()));

  async function start() {
    setPhase("reading");
    cancelled.current = false;
    count("export.latex");
    const out: LatexPage[] = [], found: Fig[] = [], bad: number[] = [];
    let fatal: string | null = null;
    for (const [k, p] of exportable.entries()) {
      if (cancelled.current) return;
      let page: LatexPage = { page: p, elements: [] };
      if (needsAi(p)) {
        setProgress(`Reading page ${p + 1} (${k + 1} of ${exportable.length})…`);
        try {
          const img = pageImage(p);
          if (!img) throw new Error("page image unavailable");
          page = await readPageForLatex(img, p, inkOnly);
        } catch (e) {
          bad.push(p);
          if (e instanceof AiError && /key|budget|offline|turn them on/i.test(e.message)) { fatal = e.message; break; }
          if (!(e instanceof AiError)) logError("latex", e);
        }
      }
      // your typed blocks (maths, text, graphs, code) go where they sit on the page
      for (const b of blocksOn(p)) {
        const el = blockToElement(b, Math.max(0, Math.min(1, (b.y - pageTop(p)) / PAGE_H)));
        if (el) page.elements.push(el);
      }
      for (const el of page.elements) {
        if (el.t !== "figure") continue;
        const [x, y, w, h] = el.bbox;
        const rect = { x: x * PAGE_W - 10, y: pageTop(p) + y * PAGE_H - 10, w: w * PAGE_W + 20, h: h * PAGE_H + 20 };
        found.push({ ...el, image: regionImage(rect) });
      }
      out.push(page);
    }
    if (cancelled.current) return;
    if (fatal && !out.some((p) => p.elements.length)) { onDone(`LaTeX export stopped: ${fatal}`); onClose(); return; }
    // a figure whose picture couldn't be made can only be redrawn (or dropped)
    const missing = new Set(found.filter((f) => !f.image).map((f) => f.id));
    for (const pg of out) pg.elements = pg.elements.filter((e) => e.t !== "figure" || !missing.has(e.id) || e.redraw);
    setPages(out);
    setFigs(found.filter((f) => f.image || f.redraw));
    setChoice(Object.fromEntries(found.map((f) => [f.id, f.redraw ? "redraw" : "image"])));
    setFailed(bad);
    count(`export.latex.figures.${Math.min(found.length, 9)}`);
    setPhase("review");
  }

  async function save() {
    const pick = (id: string): FigureChoice => (figs.find((f) => f.id === id)?.image ? choice[id] ?? "redraw" : "redraw");
    const files: Record<string, Uint8Array> = { "main.tex": strToU8(buildLatexDoc(title, pages, pick)) };
    for (const f of figs) if (f.image) files[figurePath(f.id)] = dataUrlBytes(f.image);
    const zip = zipSync(files, { level: 6 });
    const file = new File([zip.slice()], `${safeName(title, "Note")}-latex.zip`, { type: "application/zip" });
    count(`export.latex.redrawn.${Math.min(figs.filter((f) => pick(f.id) === "redraw" && f.redraw).length, 9)}`);
    const how = await shareOrDownload(file, title);
    if (how === "cancelled") return;
    onDone(how === "shared" ? "Saved. In Overleaf: New Project → Upload Project, and pick the .zip." : "Saved to your Downloads. In Overleaf: New Project → Upload Project, and pick the .zip.");
    onClose();
  }

  const counts = (t: El["t"]) => pages.reduce((n, p) => n + p.elements.filter((e) => e.t === t).length, 0);

  return (
    <Modal title={<span className="flex items-center gap-2"><FileCode2 size={16} /> Save as LaTeX</span>} onClose={() => { cancelled.current = true; onClose(); }} wide>
      {phase === "setup" && (
        <div className="space-y-4 text-sm">
          <p className="text-foreground-muted">Reads your pages into a typeset document: headings, aligned working, tables, chemical equations, boxed definitions, and your diagrams. Graphs, charts, flowcharts and simple circuits can be redrawn neatly. You check each one before saving.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant={scope === "all" ? "primary" : "secondary"} onClick={() => setScope("all")}>Whole note</Button>
            <Button variant={scope === "page" ? "primary" : "secondary"} onClick={() => setScope("page")}>This page ({currentPage + 1})</Button>
          </div>
          {printPages.some(Boolean) && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={inkOnly} onChange={(e) => setInkOnly(e.target.checked)} />
              <span>Only my handwriting <span className="text-foreground-muted">(leave out the printed text of imported pages)</span></span>
            </label>
          )}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-foreground-muted">{exportable.length ? `${exportable.length} page${exportable.length === 1 ? "" : "s"}${aiPages.length ? ` · ${cost}` : ""}` : "Nothing written on these pages yet"}</span>
            <Button variant="primary" disabled={!exportable.length} onClick={() => void start()}>Read pages</Button>
          </div>
        </div>
      )}
      {phase === "reading" && <p className="flex items-center gap-2 py-6 text-sm text-foreground-muted"><Loader2 size={16} className="animate-spin text-primary" /> {progress}</p>}
      {phase === "review" && (
        <div className="space-y-3 text-sm">
          <p className="text-foreground-muted">
            Found {[["heading", "heading"], ["math", "block of working"], ["table", "table"], ["chem", "chemical equation"], ["box", "boxed note"]]
              .map(([t, w]) => [counts(t as El["t"]), w] as const).filter(([n]) => n).map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`).join(", ") || "text only"}
            {figs.length ? `, and ${figs.length} figure${figs.length === 1 ? "" : "s"}:` : "."}
          </p>
          {figs.length > 0 && (
            <ul className="max-h-[45vh] space-y-2 overflow-auto">
              {figs.map((f) => (
                <li key={f.id} className="flex items-center gap-3 rounded-xl border border-border p-2">
                  {f.image ? <img src={f.image} alt="" className="h-16 w-24 shrink-0 rounded-md border border-border bg-white object-contain" /> : <div className="h-16 w-24 shrink-0 rounded-md border border-border bg-white" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{f.caption || "Figure"}</p>
                    <p className="text-xs text-foreground-muted">page {Number(f.id.split("-")[0].slice(1))}{f.redraw ? ` · can be redrawn as a ${KIND_LABEL[f.redraw.kind]}` : " · kept as your drawing (cleaned up)"}</p>
                  </div>
                  {f.redraw && f.image && (
                    <select value={choice[f.id]} onChange={(e) => setChoice((c) => ({ ...c, [f.id]: e.target.value as FigureChoice }))} className="rounded-lg border border-border bg-background px-2 py-1 text-xs">
                      <option value="redraw">Redraw it</option>
                      <option value="image">Use my drawing</option>
                    </select>
                  )}
                </li>
              ))}
            </ul>
          )}
          {figs.some((f) => f.redraw) && <p className="text-xs text-foreground-muted">Redrawn figures keep your original drawing in the file too (commented out), so you can swap back in Overleaf.</p>}
          {failed.length > 0 && <p className="text-xs text-negative">Couldn&apos;t read page{failed.length === 1 ? "" : "s"} {failed.map((p) => p + 1).join(", ")}, so they&apos;re left out. Try again in a minute.</p>}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-xs text-foreground-muted">A .zip with main.tex and a figures folder. Open it in Overleaf with New Project → Upload Project.</span>
            <Button variant="primary" onClick={() => void save()}>Save .zip</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
