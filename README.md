# Pipit Notes

A private, offline-first handwriting notebook. **No account, no server** — everything lives in IndexedDB on your device, so saves are instant and can't fail because of a connection.

## What it does

- **Write** with Apple Pencil: multi-page notes, PDF annotation, snip-to-new-page, page scrubber (hold the page chip and drag), shapes, lasso, undo/redo, version history, Cornell/ruled/grid/dotted paper, and optional **hold-to-snap** (hold the pen still after a rough line/circle/box and it straightens — conservative, never touches handwriting; the wand button in the tool rail).
- **Blocks** on the page: runnable **Python** (Pyodide — SymPy/NumPy/SciPy/Matplotlib), text, and **LaTeX** maths.
- **Understand** (opt-in, your own Anthropic key, off by default):
  - *Recognise maths* — lasso handwriting → LaTeX block.
  - *Check working* — the AI reads each line; **SymPy running locally** verifies every step follows from the last.
  - *Check equation* — chemistry: atoms **and** charge per element, correct coefficients, molar masses (deterministic code).
  - *Search & ask* — instant local search; ask questions answered from your own notes with citations.
  - *Practice exams* generated from your notes.
- **Organise**: notebooks, split view (two notes side by side), a knowledge map that links related notes (local TF-IDF, no AI).
- **Export**: PDF, PNG, SVG, LaTeX, whole notebook as a ZIP of PDFs.
- **Safe**: installable PWA, persistent storage, one-tap backup to iCloud Drive (share sheet), restore/merge on any device.

## Using it on the iPad

1. Deploy the `dist/` folder anywhere static (see below), open the URL in **Safari**.
2. **Share → Add to Home Screen.** Installed apps get protected storage (Safari can evict storage for non-installed sites).
3. Open the app → **Settings & backup** → confirm "Persistent storage granted".
4. Import your old notes: Settings → **Restore from backup** → choose the `.zip` files (see migration below).
5. Back up regularly: **Back up now** → Save to Files → iCloud Drive.
6. (Optional) Settings → AI features → add your API key and switch it on. Settings → **Pen test** shows what your stylus reports (rate, pressure, tilt).

## Develop

    npm install
    npm run dev          # http://localhost:5173
    npm run build        # static site in dist/
    npm run typecheck
    npm test             # 46 tests; step-checker tests need python + sympy (skipped otherwise)

## Migrate your notes from Pipit (Supabase)

Read-only — never modifies the database:

    node --env-file=../Pipit/.env tools/export-supabase.mjs --split --out data/pipit-notes.zip

This writes one `.zip` per notebook into `data/` (gitignored — it's your personal data). Get them onto the iPad (AirDrop / iCloud Drive) and restore them in the app. Only after you've confirmed everything is in Pipit Notes should you remove the notes module from Pipit.

## Deploy

It's a static site; any host works.

- **Netlify:** `npm run build`, then drag `dist/` into Netlify Drop — or connect the repo (`netlify.toml` is included).
- **Cloudflare Pages / GitHub Pages:** build command `npm run build`, output `dist`.

It must be served over **HTTPS** for install / offline / persistent storage to work.

## Privacy

Notes never leave the device unless you export or back them up. AI features send the relevant page image/text **directly from the device to Anthropic** using your own key, only when you use one of them and only if you've enabled AI. Python and the step-checker run locally in WebAssembly (the runtime downloads once from jsDelivr, then is cached for offline use).

## Layout

    src/components/note-canvas.tsx   ink engine (Catmull-Rom strokes, palm rejection, camera)
    src/lib/db.ts                    IndexedDB store
    src/lib/bundle-format.ts         backup format (shared with tools/)
    src/lib/{chem,stepcheck,py,ai,search,related,latex,svg}.ts
    src/pages/                       Library, Editor, Search, Graph, Settings
    tools/                           icon generator, Supabase export
