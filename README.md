# Pipit Notes

A private, offline-first handwriting notebook. **No account, no server** — everything lives in IndexedDB on your device, so saves are instant and can't fail because of a connection.

## What it does

- **Write** with Apple Pencil: multi-page notes, PDF annotation, snip-to-new-page, page scrubber (hold the page chip and drag), shapes, lasso, undo/redo, version history, Cornell/ruled/grid/dotted paper, and optional **hold-to-snap** (hold the pen still after a rough line/circle/box and it straightens — conservative, never touches handwriting; the wand button in the tool rail).
- **Blocks** on the page: runnable **Python** (Pyodide — SymPy/NumPy/SciPy/Matplotlib), text, and **LaTeX** maths.
- **Graph blocks** (no AI, works offline): type `y = x^2 + 3x`, `x^2 + y^2 = 25` (circles and any implicit curve), `x = y^2`, or `z = sin(x)*cos(y)` for a rotatable 3D surface — one equation per line, several curves overlay. Drag to pan/rotate, pinch or +/− to zoom, double-tap to reset. Or lasso a handwritten equation → **Graph it**.
- **Understand** (opt-in, your own Anthropic key, off by default):
  - *Recognise maths* — lasso handwriting → LaTeX block.
  - *Check working* — the AI reads each line; **SymPy running locally** verifies every step follows from the last.
  - *Check equation* — chemistry: atoms **and** charge per element, correct coefficients, molar masses (deterministic code).
  - *Explain* (lightbulb tool) — circle any concept, including printed PDF text: get an explanation, **where your own understanding fell short** (what's wrong, why, the correct version), and follow-up questions you can keep asking.
  - *Review for mistakes* (⋯ menu) — pick pages or the whole note; every mistake is found and you step through them **top to bottom**, with the spot highlighted on the page, the explanation and the fix. Mark fixed / dismiss false alarms.
  - *Search & ask* — instant local search; ask questions answered from your own notes with citations.
  - *Practice exams* generated from your notes.
- **Study** (opt-in AI to *make* material; everything else runs on the device):
  - *Flashcards* generated from your notes (or a lasso, an Explain answer, a review mistake) with spaced repetition (SM-2 style).
  - *Lessons* Duolingo-style: short sessions mixing matching, multiple choice, typing, fill-in-the-blank, ordering steps and self-graded flashcards; wrong answers come round again; hearts, combo, XP, daily goal, streak, a skill path per topic with crowns, sound effects.
  - *Quick quizzes* from your cards, scored at the end.
  - *Practice exams* written from your notes in the style of real papers: structured multi-part questions with **graphs, data tables, charts, diagrams and pictures cut from your own PDFs**. Timed; multiple-choice and numeric parts are marked locally, written/handwritten answers are marked by AI against a marking scheme; results by topic, model answers, one-tap flashcards for what you missed.
  - *Concept maps*: the AI proposes a map of the ideas in a notebook or note (concepts, with labelled links like *causes* / *is part of* / *needed for*); you edit it. **Test me from memory** hides the map and has you recall the concepts, then the links. **Colour by knowledge** shades each concept by your flashcard progress and unresolved mistakes (tap a weak one → *Study this*). Also: *Expand* a concept with AI, ask the AI **how two concepts connect**, a suggested **study order**, **flashcards from the links**, pan/zoom/search, export to PNG or an outline.
  - *Mistake log*: every mistake found by Review for mistakes, grouped by type so you can see your patterns.
- **Organise**: notebooks, multi-select (move / tag / export / delete), tags, a Recent view, batch PDF import, a pages panel (reorder, duplicate, insert, delete pages), split view, a note-links view (local TF-IDF, no AI), search hits highlighted on PDF pages.
- **Draw**: ruler (strokes snap to its edge) and protractor, pen presets + recent colours, a text tool, page templates (axes, number line, unit circle, periodic table, tables), optional scribble-to-erase, share a note as a PDF.
- **Export**: PDF, PNG, SVG, LaTeX, whole notebook as a ZIP of PDFs.
- **Safe**: installable PWA, persistent storage, one-tap backup to iCloud Drive (share sheet), restore/merge on any device.

## Using it on the iPad

1. Deploy the `dist/` folder anywhere static (see below), open the URL in **Safari**.
2. **Share → Add to Home Screen.** Installed apps get protected storage (Safari can evict storage for non-installed sites).
3. Open the app → **Settings & backup** → confirm "Persistent storage granted".
4. Import your old notes: Settings → **Restore from backup** → choose the `.zip` files (see migration below).
5. Back up regularly: **Back up now** → Save to Files → iCloud Drive.
6. (Optional) Settings → AI features → add your API key and switch it on. Settings → **Pen test** shows what your stylus reports (rate, pressure, tilt).

## Setup checklist (everything you need to provide)

**To run it locally (development)** — nothing but Node 22+:

    npm install
    npm run dev            # http://localhost:5173

**To use it on the iPad** — three things:

1. **A static host with HTTPS.** Netlify is simplest (you already use it): `npm run build`, then drag the `dist/` folder onto https://app.netlify.com/drop — or connect this repo and Netlify builds it (`netlify.toml` is set up). *Needed:* a Netlify account (free).
2. **Install it on the iPad:** open the site in Safari → Share → **Add to Home Screen**. *This matters:* installed apps get protected storage.
3. **Import your notes:** Settings → Restore from backup → pick the `.zip` files from `data/` (AirDrop / iCloud Drive them across first).

**Optional extras**

| Feature | What you provide | Where |
|---|---|---|
| AI (maths recognition, working check, search, ask, practice exams) | An **Anthropic API key** (console.anthropic.com, needs billing) | App → Settings → AI features (stored only on the device) |
| Remote problem reports | A **`DIAG_READ_TOKEN`** (any long random string you invent) | Netlify → Site configuration → Environment variables |
| Backups | Nothing — tap "Back up now" and save to iCloud Drive | App → Settings |

Nothing else: no database, no accounts, no other keys.

## Develop

    npm install
    npm run dev          # http://localhost:5173
    npm run build        # static site in dist/
    npm run typecheck
    npm test             # 120+ tests; step-checker tests need python + sympy (skipped otherwise)

## Monitoring (so problems can be found and fixed)

Everything that has a decent chance of breaking is watched, **content-free** (counts, timings, error messages, device info — never notes, titles, PDFs, code, AI questions/answers, or your API key).

| Area | What's recorded |
|---|---|
| Crashes | Uncaught errors, unhandled promise rejections, React render crashes (with a recovery screen) |
| Saving | Every local save's duration; slow saves; failures; "storage full" |
| Data loss tripwires | The browser **wiping the app's storage** (detected via a copy of the note count outside IndexedDB) and a session that **ended with unsaved edits** — both show a banner on the next launch |
| Opening notes | Load time per open; slow opens with stroke/image/page counts |
| Pen input | Per ~300 events: event rate (Hz), coalescing, stalls >32/64 ms, handler cost, pressure range |
| Backup / restore | Build time and size, share-sheet outcome (shared / fell back to download / cancelled), restore results |
| PDF import | Duration, page count, pages without a text layer, failures |
| Python & step-check | Runtime load time (network trouble), run time, how many lines SymPy could verify |
| AI | Latency, token usage, HTTP status and failure type per feature (offline vs rejected key vs rate limit) |
| Exports / search indexing / thumbnails | Durations and failures |
| Environment | App version + commit, device/browser, installed vs tab, storage quota/persistence, offline-cache state, connectivity changes |
| Usage | Which tools and features are used, and how often |

**Where it goes.** A ring-buffered log lives on the device (Settings → Health & diagnostics → *View recent events*). Three ways to get it to whoever is fixing things:

1. **Automatic** (on by default, can be turned off): when an error happens, and about once a day, the app POSTs a report (~5 KB) to `/.netlify/functions/diag` on the same site. Reports are validated, re-scrubbed and size-capped server-side and stored in Netlify Blobs.
2. **Manual:** Settings → *Share a diagnostics report* saves a `.json` you can AirDrop / send.
3. **From the crash screen:** *Save a problem report*.

**Reading reports** (needs `DIAG_READ_TOKEN` set in Netlify):

    npm run diag -- --url https://YOUR-SITE/.netlify/functions/diag --token YOUR_TOKEN --hours 48
    npm run diag -- path/to/pipit-notes-diagnostics-….json

This prints each report's health, errors, flagged problems (slow saves, input stalls, flat pressure, …), plus a rollup of the most frequent errors.

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
    src/lib/{mathexpr,graph-render,review-core}.ts   graphing + mistake review (pure, tested)
    src/lib/{srs,study-core,exam-core,figure-core,map-core}.ts  study engine + exams + figures + concept maps (pure, tested)
    src/lib/{ai-study,study-actions,study-db}.ts       study AI prompts, glue, persistence
    src/pages/StudyPage.tsx, src/components/{lesson,exam-runner,figure,ink-pad}.tsx
    src/lib/{telemetry,telemetry-core,health,report}.ts   monitoring
    netlify/                         diagnostics endpoint (Function + handler)
    src/pages/                       Library, Editor, Search, Graph, Settings
    tools/                           icon generator, Supabase export, diag-report
