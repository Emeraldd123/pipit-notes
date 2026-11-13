# Pipit Notes

A private, offline-first handwriting notebook. **No account, no server** — everything lives in IndexedDB on your device, so saves are instant and can't fail because of a connection.

Known limits are in [LIMITATIONS.md](LIMITATIONS.md). Read that before you trust it with a semester of notes.

## For a friend: getting started

1. **Open the link you were sent in Safari on your iPad.** Not Chrome, and not a link preview inside a chat app.
2. **Share → Add to Home Screen**, then open Pipit Notes from the Home Screen icon. Always use that icon from now on. The Safari tab and the Home Screen app keep separate notes, and Safari can clear storage for sites that are not installed.
3. **Write.** Notes, PDFs, graphs, Python and flashcard review all work with no key and no account.
4. **AI is optional.** If you want handwriting recognition, working checks, Explain or practice exams, get your own key and paste it in Settings → AI features, then switch on **Enable AI features**. You need one of:
   - a **Google Gemini** key from aistudio.google.com (Get API key). It has a free tier. On the free tier Google may use what you send to improve its products, and free keys allow only a few requests a minute.
   - an **Anthropic** key from console.anthropic.com. This needs prepaid credit. Practice exams were tuned on Claude, so they are better tested with this key.
5. **Back up.** Settings → Back up now → Save to Files. There is no account and no sync, so the backup file is the only other copy. The app reminds you after a week without one.

If something breaks, Settings → Health & diagnostics → Share a diagnostics report makes a file with no note content that you can send to whoever gave you the link.

## What it does

- **Write** with Apple Pencil: multi-page notes, PDF annotation, snip-to-new-page, page scrubber (hold the page chip and drag), shapes, lasso, undo/redo, version history, Cornell/ruled/grid/dotted paper, and optional **hold-to-snap** (hold the pen still after a rough line/circle/box and it straightens — conservative, never touches handwriting; the wand button in the tool rail).
- **Blocks** on the page: runnable **Python** (Pyodide — SymPy/NumPy/SciPy/Matplotlib), text, and **LaTeX** maths.
- **Graph blocks** (no AI, works offline): type `y = x^2 + 3x`, `x^2 + y^2 = 25` (circles and any implicit curve), `x = y^2`, or `z = sin(x)*cos(y)` for a rotatable 3D surface — one equation per line, several curves overlay. Drag to pan/rotate, pinch or +/− to zoom, double-tap to reset. Or lasso a handwritten equation → **Graph it**.
- **Understand** (opt-in, your own Google Gemini or Anthropic key, off by default):
  - *Recognise maths* — lasso handwriting → LaTeX block.
  - *Check working* — the AI reads each line; **SymPy running locally** verifies every step follows from the last.
  - *Math check* (under the wand, off by default): each line of maths or chemistry you finish with = or an arrow is checked as you write, and mistakes are boxed in red.
  - *Check equation* — chemistry: atoms **and** charge per element, correct coefficients, molar masses (deterministic code).
  - *Explain* (lightbulb tool) — circle any concept, including printed PDF text: get an explanation, **where your own understanding fell short** (what's wrong, why, the correct version), and follow-up questions you can keep asking.
  - *Review for mistakes* (⋯ menu) — pick pages or the whole note; every mistake is found and you step through them **top to bottom**, with the spot highlighted on the page, the explanation and the fix. Mark fixed / dismiss false alarms.
  - *Search & ask* — instant local search; ask questions answered from your own notes with citations.
  - *Practice exams* generated from your notes.
- **Study** (opt-in AI to *make* material; everything else runs on the device):
  - *Flashcards* generated from your notes (or a lasso, an Explain answer, a review mistake) with spaced repetition (FSRS-5, the scheduler Anki uses).
  - *Lessons* Duolingo-style: short sessions mixing matching, multiple choice, typing, fill-in-the-blank, ordering steps and self-graded flashcards; wrong answers come round again; hearts, combo, XP, daily goal, streak with streak freezes, a skill path per topic with crowns, sound effects.
  - *Quick quizzes* from your cards, scored at the end.
  - *Practice exams* written from your notes in the style of real papers: structured multi-part questions with **graphs, data tables, charts, diagrams and pictures cut from your own PDFs**. Timed; multiple-choice and numeric parts are marked locally, written/handwritten answers are marked by AI against a marking scheme; results by topic, model answers, one-tap flashcards for what you missed. An exam can copy the format of a real MIT OpenCourseWare exam (15 are built in, or add your own course's past exams), and can use problems from a textbook you add, but only ones your notes cover. While Claude writes an exam you see progress ("Writing question 3 of 8"), and a dropped connection is reported instead of hanging. **Report** a broken question and it stops counting toward your score (and is skipped on a retake).
  - *Concept maps*: the AI proposes a map of the ideas in a notebook or note (concepts, with labelled links like *causes* / *is part of* / *needed for*); you edit it. **Test me from memory** hides the map and has you recall the concepts, then the links. **Colour by knowledge** shades each concept by your flashcard progress and unresolved mistakes (tap a weak one → *Study this*). Also: *Expand* a concept with AI, ask the AI **how two concepts connect**, a suggested **study order**, **flashcards from the links**, pan/zoom/search, export to PNG or an outline.
  - *Mistake log*: every mistake found by Review for mistakes, grouped by type so you can see your patterns.
- **Organise**: notebooks, multi-select (move / tag / export / delete), deleted notes kept in Recently deleted for 30 days, tags, a Recent view, batch PDF import, a pages panel (reorder, duplicate, insert, delete pages), split view, a note-links view (local TF-IDF, no AI), search hits highlighted on PDF pages.
- **Draw**: ruler (strokes snap to its edge) and protractor, pen presets + recent colours, a text tool, page templates (axes, number line, unit circle, periodic table, tables), optional scribble-to-erase, share a note as a PDF.
- **Export**: PDF, PNG, SVG, LaTeX, whole notebook as a ZIP of PDFs.
- **Safe**: installable PWA, persistent storage, one-tap backup to iCloud Drive (share sheet), restore/merge on any device.

## Using it on the iPad

1. Deploy the `dist/` folder anywhere static (see below), open the URL in **Safari**.
2. **Share → Add to Home Screen.** Installed apps get protected storage (Safari can evict storage for non-installed sites).
3. Open the app → **Settings & backup** → check "Persistent storage". Safari usually grants it once the app is installed and has been used a few times, so it may say "not granted yet" on the first day.
4. Import your old notes: Settings → **Restore from backup** → choose the `.zip` files (see migration below).
5. Back up regularly: **Back up now** → Save to Files → iCloud Drive.
6. (Optional) Settings → AI features → add a Google Gemini or Anthropic key and switch AI on (see **AI providers** below). Settings → **Pen test** shows what your stylus reports (rate, pressure, tilt).

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
| AI (maths recognition, working check, search, ask, practice exams) | An **Anthropic API key** (console.anthropic.com, needs prepaid credit) and/or a **Google Gemini API key** (aistudio.google.com, has a free tier). One is enough. | App → Settings → AI features (stored only on the device) |
| Remote problem reports | A **`DIAG_READ_TOKEN`** (any long random string you invent) | Netlify → Site configuration → Environment variables |
| Backups | Nothing — tap "Back up now" and save to iCloud Drive | App → Settings |

Nothing else: no database, no accounts, no other keys.

## AI providers

AI is off until you switch it on and add a key. There are two providers and you need only one.

| Keys you have | What happens |
|---|---|
| Anthropic only | Everything runs on Claude. |
| Gemini only | Everything runs on Gemini, including exams, marking and Explain (the bigger jobs use the stronger Gemini model). Exams were tuned on Claude, so Gemini's are less tested. |
| Both | Gemini is tried first for reading handwriting, maths, working checks, math check, search answers and follow-ups. Exams and their marking stay on Claude. If Gemini is unavailable, over its cap, or its answer does not parse, the job goes to Claude. |

- Settings → AI features → **Google Gemini** has the key, the model, a "What it does" choice (reading and short answers only, or also Explain, flashcards, maps, page review and LaTeX), a monthly cap (10 US dollars by default) and a Test button.
- The Anthropic side has its own monthly budget and a spend estimate by feature. Both figures are estimates from token counts. The provider's billing page has the real number.
- Long Claude jobs are streamed. Exams show which question is being written, and a connection that goes quiet for a minute (or that died while the iPad was locked) ends with a clear message. Gemini replies are not streamed, so a Gemini-written exam shows a single waiting message until it is done.
- The older "laptop AI" route (a local model through Ollama) has been removed.

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

## Deploy (without paying for test deploys)

On Netlify's credit plans **every production deploy costs credits; draft/preview deploys are free**. So:

1. **Try it on the iPad for free first** — same Wi-Fi as the PC:

       npm run build
       npm run preview:ipad        # prints a http://192.168.x.x:4173 address — open it in Safari on the iPad

   Everything except install/offline (which need HTTPS) works there, including the Pencil.
2. **Optional HTTPS check, still free** — a draft deploy gets its own private URL and isn't charged:

       npm run deploy:test

   (A draft URL is a different site to the browser, so its notes are separate — don't keep real notes there.)
3. **Ship it once:**

       npm run deploy:prod

Both deploy scripts run the tests and a build first, so a broken build never reaches you (and failed deploys aren't charged anyway). The Netlify Function for problem reports is only deployed by the CLI scripts, not by drag-and-drop.

Any static host works too (Cloudflare Pages / GitHub Pages: build `npm run build`, output `dist`), but the problem-report endpoint is a Netlify Function. It must be served over **HTTPS** for install / offline / persistent storage to work.

## Privacy

Notes never leave the device unless you export or back them up. AI features send the relevant page image/text **directly from the device to Google (Gemini) or Anthropic (Claude)** using your own key, only when you use one of them and only if you've enabled AI. There is no Pipit server in between. On Google's free tier, Google may use what you send to improve its products; on a key with billing it says it does not. Keys are stored only on the device and are not included in backups or diagnostics reports. Content-free diagnostics (counts, timings, error messages) are sent to the site's reporting endpoint by default; turn that off in Settings → Health & diagnostics. Python and the step-checker run locally in WebAssembly (the runtime downloads once from jsDelivr, then is cached for offline use).

## Layout

    src/components/note-canvas.tsx   ink engine (Catmull-Rom strokes, palm rejection, camera)
    src/lib/db.ts                    IndexedDB store
    src/lib/bundle-format.ts         backup format (shared with tools/)
    src/lib/{chem,stepcheck,py,ai,search,related,latex,svg}.ts
    src/lib/{gemini,gemini-core,ai-route-core,sse-core}.ts   Gemini provider, which jobs go where, streamed replies
    src/lib/{mathexpr,graph-render,review-core}.ts   graphing + mistake review (pure, tested)
    src/lib/{srs,study-core,exam-core,figure-core,map-core}.ts  study engine + exams + figures + concept maps (pure, tested)
    src/lib/{ai-study,study-actions,study-db}.ts       study AI prompts, glue, persistence
    src/pages/StudyPage.tsx, src/components/{lesson,exam-runner,figure,ink-pad}.tsx
    src/components/{welcome,whats-new,gemini-ai}.tsx   first-run card, release notes, Gemini settings
    src/lib/{telemetry,telemetry-core,health,report}.ts   monitoring
    netlify/                         diagnostics endpoint (Function + handler)
    src/pages/                       Library, Editor, Search, Graph, Study, Settings
    tools/                           icon generator, Supabase export, diag-report
