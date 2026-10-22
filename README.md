# Pipit Notes

A private, offline-first handwriting notebook. No account, no server: everything lives in IndexedDB on your device.

- **Write** with Apple Pencil — multi-page notes, PDF annotation, snip-to-page, page scrubber, shapes, lasso.
- **Blocks** — runnable Python (Pyodide), text, and LaTeX maths blocks on the page.
- **Understand** (opt-in AI, your own API key) — recognise handwritten maths, check working line-by-line (SymPy runs locally), search/ask across notes, practice exams from your notes.
- **Safe** — installable PWA, persistent storage, one-tap backup to iCloud Drive via the share sheet, restore/merge on any device.

## Develop

    npm install
    npm run dev          # http://localhost:5173
    npm run build        # static site in dist/
    npm test             # step-checker tests (need python + sympy; skipped otherwise)

## Migrate notes from Pipit (Supabase)

    node --env-file=../Pipit/.env tools/export-supabase.mjs --split --out data/pipit-notes.zip

Read-only. Import the resulting `.zip` files in the app (Settings → Restore from backup).

## Deploy

Static files — any host works (Netlify, Cloudflare Pages, GitHub Pages). On iPad: open the site in Safari → Share → Add to Home Screen.
