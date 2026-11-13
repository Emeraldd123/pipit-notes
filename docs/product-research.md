# Product research: what to do before and after sharing Pipit Notes

13 November 2026, for version 0.3.0. Written for the goal "production ready for me plus a few friends".

Tags used on every claim:

- **[Found]** I verified it today in a source (linked) or in the code (file named).
- **[Inferred]** My own reasoning from what I found. Could be wrong.
- **[Open]** Only the owner can answer it.

## How good is this evidence

- **Learning science: good.** Peer-reviewed reviews, meta-analyses and one large classroom trial. I read abstracts and summaries today, not every full paper.
- **Storage and API terms: good.** WebKit's own blog and Google's own terms.
- **What students say about other apps: weak.** My search tools could not open Reddit at all, so there are no Reddit threads in this document. What I have is GoodNotes' own feedback forum, Microsoft's Q&A site, and comparison blogs. Many of those blogs are written by competitors. I use them only for themes that several sources repeat. There are no reliable numbers on how common any complaint is, and I give none.
- **Bring-your-own-key launches: weak.** Developer blog posts and opinion. I found no published drop-off figures.

## The three things most worth doing before sharing

### 1. Keep telling people to install until they have (fix, S)

- The getting-started card is shown only while the Library has zero notes. [Found: `src/pages/Library.tsx` line 424, `notes.length === 0 && <Welcome />`]
- So a friend who opens the link in a Safari tab and writes one note never sees the install advice again unless they open Settings. [Found: `standalone` is checked only in `welcome.tsx`, `SettingsPage.tsx`, `health.ts`, `report.ts`]
- Safari can evict a non-installed site's data when it has not been used for some time or under storage pressure. WebKit grants persistent storage "based on heuristics like whether the website is opened as a Home Screen Web App". [Found: [WebKit, Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)]
- Notes written in the tab are not in the Home Screen app, so installing late looks like data loss. [Inferred: iOS keeps Home Screen web app storage apart from Safari. The README already says a different URL has separate notes. I did not test this on a device today.]
- Lost or missing notes is the loudest complaint I could find about GoodNotes: a long-running "Fix iCloud Sync" thread, "missing pages after iCloud sync", notebooks stuck uploading. [Found: [GoodNotes feedback forum](https://feedback.goodnotes.com/forums/191274-goodnotes-ideas/suggestions/17270900-fix-icloud-sync), [missing pages report](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/49736933-urgent-missing-pages-after-icloud-sync). Posts are undated and show that the complaint exists, not how common it is.]
- What to build: a small banner in the Library whenever the app is running in a browser tab, saying "You are in Safari. Add to Home Screen, then use the icon. Notes written here stay here." It stays until installed. Add one line to the Welcome card about tab and app being separate.
- Files: `src/pages/Library.tsx`, `src/components/welcome.tsx`.
- The backup reminder itself is fine: it shows as soon as there is one note and no backup. [Found: `src/lib/backup.ts` `backupIsOverdue`]

### 2. Finish the Gemini-only path, because that is the one friends will take (fix, S to M)

The Welcome card points new users at Gemini first because it has a free tier. [Found: `src/components/welcome.tsx`] So most friends will have only a Gemini key. That path has rough edges:

- Health check says "AI is switched on but no API key is set" to a user who has a working Gemini key. [Found: `src/lib/health.ts` line 174 checks only `apiKey`]
- Diagnostics reports record `hasKey` from the Anthropic key only, so the owner cannot tell a Gemini-only friend from a friend with no key. [Found: `src/lib/report.ts` line 74]
- Settings → AI features shows the Anthropic key, model, cheaper model, careful mode and budget first. The Gemini box is at the bottom. A friend with a free Gemini key has to scroll past settings that do not apply to them. [Found: `src/pages/SettingsPage.tsx` lines 103 to 150]
- Gemini replies are not streamed (`generateContent`), so a Gemini-written exam shows "Planning your exam (a full paper takes a minute or two…)" with no progress, for up to the 240 second timeout. The new progress and dropped-connection handling only cover Claude. [Found: `src/lib/gemini.ts` lines 46 and 78, `src/lib/ai.ts` `readStream`]
- Free keys are rate limited, and the app does say so in its error. [Found: `src/lib/ai.ts` `GEMINI_ONLY_ERRORS`] Math check and auto-indexing make many small calls, which is where a free key will hit the limit first. [Inferred]
- The header comment in `src/lib/gemini.ts` still says "exams stay on Claude", which is no longer true without a Claude key. [Found]
- Evidence that this matters: every source I found on bring-your-own-key apps names key setup as the main friction, and says errors must be specific with a way to recover. [Found, weak: [dev.to, "The first 30 seconds"](https://dev.to/dimagious/the-first-30-seconds-why-my-ai-extension-lost-users-before-the-ai-even-ran-2inb), [macmyths, BYOK: who pays, where keys go, what can fail](https://macmyths.com/byok-who-pays-where-keys-go-and-what-can-fail/). Opinion pieces, no numbers.]
- What to build, smallest first: fix the health check and `hasKey`; fix the comment; when there is no Anthropic key, show the Gemini box first and fold the Anthropic settings away; then stream Gemini with `streamGenerateContent` so exams get the same progress and stall detection.
- Files: `src/lib/health.ts`, `src/lib/report.ts`, `src/pages/SettingsPage.tsx`, `src/components/gemini-ai.tsx`, `src/lib/gemini.ts`, `src/lib/gemini-core.ts`.

### 3. Measure Gemini exams once, and say plainly on the exam screen that AI can be wrong (fix, S for the label, M for the measurement)

- Exam quality has only been measured on `claude-sonnet-5-5`. [Found: `docs/exam-quality.md`]
- On Claude, round 3 averaged 1.66 of 2 for factual accuracy, with arithmetic slips in model answers as the main weakness. [Found: `docs/exam-quality.md`]
- A Gemini-only user gets exams, marking and Explain from Gemini with no measurement behind them. The Settings box says so, but the exam screen does not. [Found: `src/components/gemini-ai.tsx`, `src/lib/ai-route-core.ts`]
- A wrong model answer is worse than no answer, because the student may learn it. Reviewers of NotebookLM give the same advice: treat it as an assistant, check the source. The American Medical Association's write-up of a Brown study warns that poorly calibrated AI study content introduces misinformation. [Found: [U-M LSA, A Critical Look at NotebookLM](https://sites.lsa.umich.edu/learningteachingconsulting/2026/03/12/a-critical-look-at-notebooklm/), [AMA](https://www.ama-assn.org/medical-students/succeed-medical-school/using-ai-study-medical-students-should-know-do-s-and-don-ts)]
- NotebookLM's answer to this is that each quiz question links back to the passage it came from. [Found: [Tom's Guide](https://www.tomsguide.com/ai/i-tried-googles-notebooklm-update-and-it-actually-helped-me-remember-what-i-read)] Pipit already cites sources in Search & ask. [Found: `src/lib/ai.ts` line 302] Exam model answers do not link back to a note page. [Inferred from the exam prompt summary in `docs/exam-quality.md`; I did not read `exam-prompt.ts` in full.]
- What to do: run `npm run eval:exam` against Gemini once if the harness can be pointed at it [Open: can it?]. Turn "Double-check every answer" on by default when Gemini writes the exam. Add one line on the results screen: "Written by AI. If a model answer looks wrong, check your notes and tap Report."
- Files: `tools/exam-eval.mjs`, `src/pages/StudyPage.tsx`, `src/components/exam-runner.tsx`.

## Findings

### 1. What students value and complain about in comparable tools

**GoodNotes and Notability**

- Both are highly rated on the App Store. Comparison sites agree the choice mostly comes down to audio recording synced to notes (Notability) against deeper PDF and notebook tools and a one-time price (GoodNotes). [Found: [Paperlike](https://paperlike.com/blogs/paperlikers-insights/app-review-goodnotes-vs-notability), [Setapp](https://setapp.com/app-reviews/goodnotes-vs-notability), [AFFiNE](https://affine.pro/blog/goodnotes-vs-notability). Prices and ratings differ between these pages, so I do not quote them.]
- The complaint with the most first-hand posts behind it is sync: notes not appearing on another device, pages missing after sync, uploads stuck. One poster wrote that before an exam they need to know their notes will be on both devices. [Found: [GoodNotes forum](https://feedback.goodnotes.com/forums/191274-goodnotes-ideas/suggestions/17270900-fix-icloud-sync)]
- GoodNotes support states that iCloud sync is not a backup and warns against uninstalling while troubleshooting, because that can remove local data. [Found: [GoodNotes support](https://support.goodnotes.com/hc/en-us/sections/14039123781263-iCloud)]
- What this means for Pipit: students judge a notes app first on "will my notes be there". Pipit has no sync to break, which is a strength, and no second copy unless the user makes one, which is the risk. [Inferred]

**OneNote on iPad**

- Valued: a free-form page that mixes handwriting, typing, diagrams and screenshots, which suits maths and chemistry. [Found, weak: [Scholarly blog](https://scholarly.so/blog/why-is-onenote-so-bad-for-studying-honest-answer), a competitor]
- Complaints: Apple Pencil lag and flicker, sync conflicts, the pen switching to text by surprise. [Found: [Microsoft Q&A thread on Pencil lag](https://learn.microsoft.com/en-us/answers/questions/5788251/one-note-lagging-with-apple-pencil). The other pages were third-party troubleshooting articles, which show that people search for these problems.]
- For Pipit: ink latency is a first-day make-or-break. Pipit already measures pen event rate and stalls and has a Pen test screen. [Found: README Monitoring, `src/components/pentest.tsx`] [Open: has it been tried on a friend's iPad model and Pencil, not only the owner's?]

**Anki, RemNote, Quizlet**

- Sources agree on the shape: Anki is the most capable and the hardest to set up, with manual card making; Quizlet is the easiest and has moved Learn mode and practice tests behind payment; RemNote sits between, with cards made from notes. [Found, weak: [RemNote blog](https://www.remnote.com/blog/anki-vs-quizlet-vs-remnote) (a vendor comparing itself), [Heuristica on Quizlet alternatives](https://www.heuristi.ca/posts/quizlet-alternatives), [dev.to on Anki alternatives](https://dev.to/brainrash_edu/best-anki-alternatives-for-modern-students-2026-4nm8)]
- I could not verify first-hand student complaints about Anki review load or burnout. I looked and found only vendor blogs.
- One preprint from Brown University found that medical students who used AI-generated Anki cards scored within an equivalence margin of those who did not, and most reported saving time. It is a preprint, in one school. [Found: [medRxiv](https://www.medrxiv.org/content/10.1101/2025.05.13.25327518.full.pdf)]
- For Pipit: cards made from your own notes with FSRS and no setup is what these sources say students want. Pipit already does it. The gap against Quizlet is sharing a deck with a classmate. [Found: study data only leaves the device inside a full backup, `src/lib/backup.ts` line 47]

**Notion-style AI study tools**

- Notion AI works on typed content already in Notion and has no review scheduler; flashcards there are a workaround. [Found, weak: [Notelyn](https://www.notelyn.com/blog/is-notion-ai-worth-it), [StudyCards AI comparison](https://studycardsai.com/vs/notion-vs-studycards), both competitors. A third guide disagrees on details.]
- For Pipit: nothing to copy. Handwriting plus scheduling is the difference.

**NotebookLM**

- Valued: answers grounded only in the sources you upload; flashcards and quizzes with saved progress; each question links back to its source. [Found: [Educators Technology](https://www.educatorstechnology.com/2026/09/notebooklm-flashcards-quizzes-study-workflow.html), [Tom's Guide](https://www.tomsguide.com/ai/i-tried-googles-notebooklm-update-and-it-actually-helped-me-remember-what-i-read)]
- Cautions: treat it as an assistant; with many sources it draws less from each (one teacher's report, not a measurement). I found no independent study of its error rate. [Found: [U-M LSA](https://sites.lsa.umich.edu/learningteachingconsulting/2026/03/12/a-critical-look-at-notebooklm/)]
- For Pipit: the link from a question back to the note page it came from is the feature worth copying. See recommendation 3.

### 2. What learning science supports, and what Pipit does

| Technique | Evidence | In Pipit today | Gap |
|---|---|---|---|
| Retrieval practice (testing yourself) | Rated high utility in the Dunlosky review of ten techniques. [Found: [APS summary](https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html), DOI 10.1177/1529100612453266] | Flashcards, lessons, quizzes, exams, concept map "Test me from memory". [Found: README, `src/components/recall-mode.tsx`] | None of note. |
| Spacing | Rated high utility in the same review. [Found, same source] | FSRS-5 scheduling. [Found: `src/lib/srs.ts`] Exams and mistakes are not scheduled. [Inferred] | Bring missed exam parts and logged mistakes back on a schedule. |
| Interleaving (mixing problem types) | Rated moderate by Dunlosky. A cluster-randomised trial with 54 seventh-grade maths classes found 61% against 38% on a test a month later (d = 0.83). One district, maths worksheets only. [Found: [WWC review](https://ies.ed.gov/ncee/WWC/Study/80702), [paper](https://www.gwern.net/doc/psychology/spaced-repetition/2019-rohrer.pdf)] | "Review due" mixes all topics; lessons shuffle. Topic lessons are blocked by design. [Found: `src/lib/study-core.ts` `selectCards`] | No mixed problem practice across topics or courses. Exam scope across notebooks: [Open]. |
| Worked examples | Meta-analysis in maths: medium effect (g = 0.48). Helps novices most; fades as skill grows (expertise reversal). [Found: [Barbieri et al. 2023 poster](https://www.cehd.udel.edu/wp-content/uploads/2022/02/Worked-Examples-Meta-Poster_022722_SC.pdf), [Springer review](https://link.springer.com/doi/10.1007/s10648-010-9136-5)] | Explain gives worked explanations; exams give model answers. [Found: README] | No "worked example, then the same kind of problem with steps removed". |
| Self-explanation | Meta-analysis of 64 reports: g = 0.55. Rated moderate by Dunlosky. [Found: [Bisra et al. 2018](https://www.gwern.net/doc/psychology/spaced-repetition/2018-bisra.pdf), [BPS digest](https://www.bps.org.uk/research-digest/self-explanation-powerful-learning-technique-according-meta-analysis-64-studies)] The Barbieri analysis found self-explanation prompts added to worked examples did not help, so the two sources pull in different directions. | Explain critiques what you already wrote ("where your understanding fell short"). [Found: `src/lib/ai.ts` line 399] | It never asks you to explain first. |
| Pretesting (guess before you study) | Failed attempts followed by the answer improved later memory in lab and text-reading studies. [Found: [Richland, Kornell & Kao 2009](https://learninglab.uchicago.edu/Pre-Testing_files/RichlandKornellKao.pdf), [PubMed](https://pubmed.ncbi.nlm.nih.gov/19751074/)] The benefit can vanish if feedback is delayed. [Found: [Grimaldi & Karpicke 2012](https://learninglab.psych.purdue.edu/downloads/2012/2012_Grimaldi_Karpicke_MC.pdf)] Mostly lab evidence. | Nothing. Everything in Study starts from notes that already exist. [Found: no pretest code in `src/`] | A "quiz me before I read" mode with immediate answers. |
| Highlighting and rereading | Rated low utility by Dunlosky. [Found, same source] | Highlighter exists, as it must. | No action. Do not build features around it. |

Roediger and Karpicke (2006) is the classic retrieval-practice experiment. I did not re-verify its numbers today, so I do not quote them.

### 3. Common failure points for a small bring-your-own-key, local-only launch

- **Data loss by eviction or by not installing.** Covered in recommendation 1. Pipit is better prepared than most: persistent storage request, a wiped-storage tripwire, an unsaved-edits tripwire, and a backup reminder. [Found: `src/lib/health.ts`, `src/lib/db.ts` line 352, `src/lib/backup.ts`]
- **Key setup.** Two steps that are easy to half-do: paste a key, and switch on "Enable AI features". [Found: `src/lib/settings.ts` `aiReady`] A friend who pastes a key and leaves the switch off gets "AI features aren't set up". [Found: `src/lib/ai.ts` line 102] [Inferred: switching AI on when a first key is pasted would remove one failure.]
- **Free-tier privacy.** On Google's free tier, Google may use prompts and replies to improve products, human reviewers may read them, and the terms say not to submit sensitive or personal information. On a paid key it says it does not use them. [Found: [Gemini API terms](https://aistudio.google.com/docs/terms)] Pipit says the first part in Settings. [Found: `src/pages/SettingsPage.tsx` line 211]
- **Terms that restrict who can use a free key.** Google's API terms require users to be 18 or older, and say only paid services may be used when making an API client available to users in the EEA, Switzerland or the UK. [Found: same terms] [Open: is every friend 18 or older, and is anyone in those regions? I am not a lawyer and this is not legal advice.]
- **Anthropic needs money up front.** Usage is paid from prepaid credits that expire after a year and are not refundable. [Found: [Anthropic help](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage)] Third-party guides give a 5 dollar minimum; I could not confirm that on Anthropic's own pages.
- **Trust.** "What does this send, and to whom?" Pipit answers this well in Settings → About. [Found: `src/pages/SettingsPage.tsx` lines 208 to 214] One thing friends may not expect: content-free diagnostics go to the owner's endpoint by default. [Found: `src/lib/settings.ts` `reportEnabled: true`] It is disclosed. Say it out loud when you share the link. [Inferred]
- **Long jobs on a locked iPad.** Handled for Claude with a clear message. Not for Gemini. [Found: `src/lib/ai.ts` `DROPPED`, `src/lib/gemini.ts`]
- **No way to tell you something is wrong.** There is a diagnostics report but no "send feedback" button or contact. [Found: no feedback or mailto in `src/`] With five users, a text message works. [Inferred]

## Ranked recommendations

| # | What | Kind | Size | Files |
|---|---|---|---|---|
| 1 | Persistent "not installed" banner; say tab and app are separate | Fix | S | `src/pages/Library.tsx`, `src/components/welcome.tsx` |
| 2 | Finish the Gemini-only path (health check, `hasKey`, Settings order, stale comment, then streaming) | Fix | S, then M | `src/lib/health.ts`, `src/lib/report.ts`, `src/pages/SettingsPage.tsx`, `src/lib/gemini.ts`, `src/lib/gemini-core.ts` |
| 3 | Measure Gemini exams once; default double-check on Gemini; "AI can be wrong" line on results | Fix | S and M | `tools/exam-eval.mjs`, `src/pages/StudyPage.tsx`, `src/components/exam-runner.tsx` |
| 4 | Turn AI on when the first key is pasted; one "Test" that checks whichever key exists | Fix | S | `src/pages/SettingsPage.tsx`, `src/components/gemini-ai.tsx` |
| 5 | Share a deck or an exam as a file | New | M | `src/lib/backup.ts`, `src/lib/bundle-format.ts`, `src/pages/StudyPage.tsx` |
| 6 | Pretest mode: "quiz me before I read" | New | M | `src/pages/StudyPage.tsx`, `src/lib/ai-study.ts`, `src/components/lesson.tsx` |
| 7 | "Your turn first" in Explain | New, small change to an existing tool | S to M | `src/components/understanding.tsx`, `src/lib/ai.ts` |
| 8 | Bring mistakes and missed exam parts back on a schedule | Fix | M | `src/lib/study-actions.ts`, `src/lib/study-core.ts`, `src/lib/study-db.ts` |
| 9 | Mixed practice across topics and courses | New | M | `src/lib/study-core.ts`, `src/pages/StudyPage.tsx`, `src/lib/exam-prompt.ts` |
| 10 | Worked example, then a faded version to complete | New | L | `src/lib/ai-study.ts`, `src/lib/study-core.ts`, `src/components/lesson.tsx` |

Details for 4 to 10 (1 to 3 are at the top):

**4. Turn AI on when the first key is pasted.** Evidence: the two-step setup above [Found], and the general bring-your-own-key friction sources [Found, weak]. Keep the master switch so it can be turned off. Also show the Anthropic "Test connection" result inline like the Gemini one does, instead of a toast that disappears. [Inferred]

**5. Share a deck or an exam as a file.** Evidence: classmates on the same course is the exact case Quizlet's shared sets serve [Inferred]. Today cards and exams only travel inside a full backup [Found: `src/lib/backup.ts` line 47]. A friend without an AI key could then still study a deck someone else generated. [Inferred] Check the merge rule so an imported deck does not carry the sender's review history. [Open: do you want friends to see each other's exams, given they are built from one person's notes?]

**6. Pretest mode.** Evidence: Richland et al. 2009 and Kornell et al. 2009 [Found], with the caveat that feedback must come straight away (Grimaldi & Karpicke 2012) [Found]. Pipit has nothing that runs before the notes exist [Found]. Shape: pick a PDF or a textbook chapter you have not read, get 5 to 8 short questions, commit to a guess, see the answer and a one-line reason at once. Wrong guesses become flashcards. Lab evidence is stronger than classroom evidence here.

**7. "Your turn first" in Explain.** Evidence: self-explanation g = 0.55 across 64 reports [Found]. Explain already judges what you wrote on the page [Found]. Add an optional step: before the explanation shows, write or type one line on what you think it means. Then the explanation compares. Make it skippable, because the worked-example meta-analysis found forced prompts can hurt [Found].

**8. Bring mistakes back on a schedule.** Evidence: spacing is one of the two best-supported techniques [Found]. The mistake log groups mistakes by type and offers one-tap cards [Found: README]. Whether a logged mistake ever comes back without the user making a card: [Open, I did not trace `study-actions.ts` fully]. If it does not, auto-make one card per confirmed mistake.

**9. Mixed practice across topics and courses.** Evidence: Rohrer et al. 2020, d = 0.83, with the limits noted above [Found]. The benefit in that trial was for problems where choosing the method is the hard part, which fits statistics (which test?) and chemistry well. [Inferred] Card review already mixes [Found]. The gap is problem practice: a short "mixed set" drawn from several topics, or an exam scope that spans notebooks.

**10. Worked example, then a faded one.** Evidence: g = 0.48 in maths, strongest for novices [Found]. Largest build, and the AI must write correct steps, which is the known weak point (arithmetic in model answers) [Found: `docs/exam-quality.md`]. SymPy step checking could verify the generated steps. [Inferred] Do this last.

**Looked at and not recommended now**

- Sync or accounts. It is the top complaint about other apps, and adding a server is how those complaints start. Backup files are enough for a few friends. [Inferred]
- Audio recording tied to ink (Notability's main draw). Large, and outside what Pipit is for. [Inferred]

## Questions for the owner that would change the ranking

1. [Open] Will most friends use a free Gemini key, an Anthropic key, or no AI at all? If no AI, recommendation 2 and 3 drop and 5 (shared decks) rises.
2. [Open] Are all friends on an iPad with a Pencil? If some will open it on a phone or laptop, "tested target" needs a harder warning, and layout checks move into the top three.
3. [Open] Is everyone 18 or older and outside the EEA, UK and Switzerland? If not, do not suggest the free Gemini tier to them.
4. [Open] Can `tools/exam-eval.mjs` run against Gemini, or is it Claude only? That sets the size of recommendation 3.
5. [Open] Do you want diagnostics on by default for friends? It is the only way you will learn about their problems, and it is content-free, but it is their device.
6. [Open] Has a full backup been restored on a second iPad recently? I did not test it. If not, do that once before anything else.
