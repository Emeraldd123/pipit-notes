// One-time migration: read your notes out of the Pipit (Supabase Postgres) database
// and write them as a Pipit Notes backup bundle you can import into the new app.
// READ-ONLY — it never modifies or deletes anything in the database.
//
//   node --env-file=../Pipit/.env tools/export-supabase.mjs [--out data/export.zip] [--split]
//
// --split writes one .zip per notebook (smaller files, easier on an iPad's memory).
import pg from "pg";
import { zipSync } from "fflate";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { bundleFiles } from "../src/lib/bundle-format.ts";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const OUT = opt("--out", "data/pipit-notes-export.zip");
const SPLIT = flag("--split");

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("No DIRECT_URL/DATABASE_URL. Run with: node --env-file=../Pipit/.env tools/export-supabase.mjs");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000 });
client.on("error", () => {});
await client.connect();
const q = async (sql, params = []) => (await client.query(sql, params)).rows;
const ts = (d) => (d ? new Date(d).getTime() : Date.now());

const notebooks = (await q(`SELECT id, name, color, "createdAt" FROM "Notebook"`)).map((r) => ({
  id: r.id, name: r.name, color: r.color || "#3d5244", createdAt: ts(r.createdAt),
}));
const noteRows = await q(`SELECT id, title, "notebookId", paper, "pageCount", tags, "isPinned", "createdAt", "updatedAt" FROM "Note" ORDER BY "updatedAt" DESC`);
console.log(`${notebooks.length} notebooks, ${noteRows.length} notes`);

const notes = [];
for (const [i, n] of noteRows.entries()) {
  const strokes = (await q(`SELECT id, tool, color, width, points FROM "NoteStroke" WHERE "noteId" = $1 ORDER BY "createdAt" ASC, id ASC`, [n.id])).map((s) => ({
    id: s.id, tool: s.tool, color: s.color, width: s.width,
    points: (Array.isArray(s.points) ? s.points : []).map((p) => ({ x: p.x, y: p.y, p: p.p ?? 0.5 })),
  }));
  const images = [];
  for (const im of await q(`SELECT id, data, x, y, width, height, rotation, "zIndex" FROM "NoteImage" WHERE "noteId" = $1 ORDER BY "zIndex" ASC, "createdAt" ASC`, [n.id])) {
    const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(im.data || "");
    if (!m) continue;
    images.push({ id: im.id, x: im.x, y: im.y, width: im.width, height: im.height, rotation: im.rotation ?? 0, zIndex: im.zIndex ?? 0, mime: m[1], bytes: new Uint8Array(Buffer.from(m[2], "base64")) });
  }
  const tr = (await q(`SELECT text FROM "NoteTranscription" WHERE "noteId" = $1`, [n.id]))[0];
  const pageText = tr?.text?.trim()
    ? [{ key: `${n.id}:0:ink`, noteId: n.id, page: 0, source: "ink", text: tr.text, hash: "imported", updatedAt: Date.now() }]
    : [];
  notes.push({
    meta: {
      id: n.id, title: n.title, notebookId: n.notebookId ?? null, paper: n.paper, pageCount: n.pageCount || 1,
      tags: n.tags ?? [], isPinned: !!n.isPinned, createdAt: ts(n.createdAt), updatedAt: ts(n.updatedAt),
      strokeCount: strokes.length, imageCount: images.length,
    },
    strokes, blocks: [], pageText, images,
  });
  console.log(`  [${i + 1}/${noteRows.length}] ${n.title} — ${strokes.length} strokes, ${images.length} images, ${n.pageCount} pages`);
}
await client.end();

function write(path, bundle) {
  mkdirSync(dirname(path), { recursive: true });
  const files = bundleFiles(bundle);
  const input = {};
  for (const [name, bytes] of Object.entries(files)) input[name] = [bytes, { level: name.startsWith("images/") ? 0 : 1 }];
  const zipped = zipSync(input);
  writeFileSync(path, zipped);
  console.log(`wrote ${path} — ${bundle.notes.length} notes, ${(zipped.length / 1048576).toFixed(1)} MB`);
}

if (!SPLIT) {
  write(OUT, { notebooks, notes });
} else {
  const base = OUT.replace(/\.zip$/i, "");
  const groups = new Map();
  for (const n of notes) {
    const k = n.meta.notebookId ?? "unfiled";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  for (const [k, group] of groups) {
    const nb = notebooks.find((b) => b.id === k);
    const name = (nb?.name ?? "Unfiled").replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-");
    write(`${base}-${name}.zip`, { notebooks: nb ? [nb] : [], notes: group });
  }
}
console.log("done.");
