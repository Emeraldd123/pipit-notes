# Limitations

Pipit Notes is a personal project shared with a few classmates. This page says what it does not do and where it can let you down. Each point was checked against the code or the README on 13 November 2026 (version 0.3.0).

## Your notes live on one device

- There is no account, no server and no sync. Notes, PDFs, flashcards and exams are stored in the browser's storage (IndexedDB) on the device you wrote them on.
- The only way to move or protect them is a backup file: Settings → Back up now → Save to Files. Restoring a backup on another device merges it in, with the newer copy of each note winning. That is a manual copy, not sync.
- If you lose the iPad, delete the Home Screen app, or clear Safari's website data, and you have no backup, the notes are gone. Nobody can recover them for you.
- The app reminds you when you have notes and no backup in the last 7 days. It does not back up by itself.
- API keys and settings are not in the backup. On a new device you paste the key again.

## Install it, or Safari may clear it

- The tested setup is an iPad, Safari, added to the Home Screen, with an Apple Pencil. Other browsers and devices may work but are not what the author uses day to day.
- Safari can delete storage for sites that are not installed. Add Pipit to the Home Screen and open it from that icon.
- Notes written in a Safari tab do not show up in the Home Screen app. They are stored separately. Install first, then start writing. If you already wrote in the tab, back up there and restore in the installed app.
- Even when installed, "Persistent storage" is granted by Safari on its own rules, usually after a few uses. Settings shows whether you have it. Back up either way.
- If storage is wiped, the app notices on the next launch and tells you. It cannot bring the notes back.

## AI needs your own key, and it costs what you use

- AI is off by default. Writing, PDFs, graph blocks, Python, LaTeX blocks and flashcard review work without it.
- To use AI you paste your own key from Google (Gemini) or Anthropic (Claude). The author does not pay for your usage and never sees your key.
- Google Gemini has a free tier. Free keys are rate limited, so a burst of requests can fail with "wait a minute and try again". On the free tier Google may use what you send to improve its products, and its terms say human reviewers may read it. Google's API terms also require you to be 18 or older.
- Anthropic needs prepaid credit. The getting-started card says "a few dollars a month in normal use". That is the author's own experience, not a measured figure. Writing many exams or turning on Careful mode costs more.
- The spend figures in Settings are estimates from token counts. Your real bill is on the provider's billing page. You can set a monthly cap for each provider. The Gemini cap starts at 10 US dollars.
- Making study material from handwritten notes needs AI to read the handwriting first. Without a key, flashcards and exams can only be made from typed text and PDFs that have a text layer, or written by hand.

## AI answers can be wrong

- Explanations, mistake reviews, flashcards, marking and exam questions are written by a language model. They can be wrong and sound confident.
- The app reduces this in a few places. Check working verifies each algebra step with SymPy on the device. Check equation balances atoms and charge with ordinary code. Multiple choice and numeric exam parts are marked locally. Exams can be double-checked by a second AI pass. Every exam question has a Report button that removes it from your score.
- These checks do not remove the problem. In the author's last evaluation of Claude-written exams (docs/exam-quality.md), questions averaged 1.66 out of 2 for factual accuracy, and most deductions were arithmetic slips in model answers. Treat a model answer you disagree with as possibly wrong, and check it against your course material.
- AI marking of written answers is a guide, not a grade.

## Exams written by Gemini are less tested

- Exam prompts were tuned and measured on Claude only. With both keys, exams and marking always use Claude.
- With only a Gemini key, exams are written and marked by Gemini. They have not been through the same evaluation. Expect more broken questions, and use Report.
- A Gemini-written exam shows one waiting message until it is finished. The "Writing question 3 of 8" progress only appears when Claude writes the exam.
- Long AI jobs need the app open and the iPad awake. If the iPad locks or you switch apps, the job can fail and you start it again.

## No collaboration

- No shared notebooks, no live editing, no comments, no accounts.
- You can share a note as a PDF, or send a backup file, and that is all.

## Other things to know

- Content-free diagnostics (counts, timings, error messages, device model) are sent to the site's reporting endpoint by default. They never include notes, titles, AI questions or answers, or keys. Turn this off in Settings → Health & diagnostics.
- Python blocks download their runtime from jsDelivr the first time, so the first run needs a connection.
- There is one developer and no support desk. Updates arrive when the installed app next loads online, and What's New lists what changed.
