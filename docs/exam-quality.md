# Practice-exam quality: evaluation results

How realistic are the exams Pipit Notes writes? This is what three rounds of measuring and fixing found
(2 November 2026, model `claude-sonnet-5-5`, default "medium" effort).

## Method

`tools/exam-eval.mjs` (run with `npm run eval:exam`) writes one 8-question exam per subject from sample
student notes in `tools/exam-fixtures.mjs`. The subjects are cellular respiration, chemical equilibrium,
DC circuits, supply and demand, and hypothesis testing. Each exam uses **exactly the prompt the app
sends** (`src/lib/exam-prompt.ts`) and goes through the app's own validation
(`normalizeExam`, `checkSolvable`).

A separate "strict head of department" model call then reviews each question, with the notes and every
figure's data in front of it. It scores six criteria from 0 to 2: realistic, applied (case questions
only), self-contained, one defensible answer, factually accurate, and distractor quality. Automatic
checks count letter answer keys, references to figures that aren't attached, case-study share, and
classic MCQ item-writing flaws.

The case-study instructions are subject-neutral. The fixtures deliberately leave out the classic cases
(inhibitors, real markets, real circuits, famous studies) so the examiner has to bring them in.

## Results (averages across subjects, 0–2)

| | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| Realistic | 1.73 | 1.85 | 1.81 |
| Applied (case questions) | 1.88 | 1.67 | 1.80 |
| Self-contained | 1.02* | 1.92 | **2.00** |
| One defensible answer | 1.50 | 1.88 | 1.79 |
| Factually accurate | 1.55 | 1.82 | 1.66 |
| Distractors | 1.40 | 1.77 | 1.63 |
| MCQ answer keys pointing at the wrong option | ~half | **0** | **0** |
| Figures referenced but missing | – | 1 (false positive) | 1 |
| Case-study share (target ⅓) | 38–75% | 38% | 38% (bio 50%) |

\* Round 1 self-contained was understated. The reviewer couldn't see the figures, which the harness fixed
for round 2. Round 2 covered 4 subjects (economics hit a network error); rounds 1 and 3 covered all 5.
Each figure is one exam per subject (~8 questions), so differences of about ±0.2 between rounds 2 and 3
are within noise. The real gains were from round 1 to round 2.

## What the rounds changed

**Round 1 → 2**
- *Bug (live app):* models key multiple choice by letter ("A"), but the app shuffles options, so the
  displayed model answer could name the wrong option. Letter keys are now rewritten to the option text.
- Never write "below", "as shown" or "the table" unless the figure is attached. Every needed value goes
  in the stem or the figure.
- State the convention whenever there is more than one (midpoint vs simple %, g, sig figs,
  one- vs two-sided).
- Exactly ⅓ case questions (chemistry had produced 6 of 8).

**Round 2 → 3**
- *Bug (live app):* table headers were cut off at 30 characters, dropping units. They now allow 60.
- Don't copy the notes' worked examples, and keep recall to short parts.
- Numeric distractors come from actually making a named error.
- One scheme point per mark.
- Check every causal claim.
- A case question needs a reasoning step beyond restating the principle.

## Examples of case questions it wrote (none of these cases are in the notes)

- **Biology:** the uncoupler DNP; cyanide at complex IV and the rise in lactate; an oxygen-electrode
  trace after adding ADP and then an uncoupler.
- **Chemistry:** removing ammonia in the Haber process; why warm fizzy drinks go flat; a lime kiln
  (CaCO₃ ⇌ CaO + CO₂) when the volume is halved.
- **Physics:** a cold lamp filament drawing a surge of current at switch-on; a heater losing power
  through a thin extension cord; jump-starting a car battery.
- **Economics:** who pays a tax on a drug with no substitutes; rent control; ride prices surging
  after a concert.
- **Statistics:** 20 foods tested and one false positive; a huge-sample "proven to raise scores"
  claim with a 0.4-point effect; vitamins vs heart disease confounded by exercise and smoking.

## Remaining weaknesses

1. **Arithmetic in hand-built datasets.** Most accuracy deductions in round 3 were internal consistency
   slips in a model answer: a fermentation yield comparison, a price-floor answer, a battery-current
   setup. This is the main thing left to improve. Options: turn on *Careful mode* in Settings (more
   thinking for exams), or add a second "check the answers" pass (an extra few cents per exam).
2. **Occasional short exams.** Biology returned 6 questions instead of 8 in round 3.
3. **The reviewer is itself strict and sometimes inconsistent.** Several deductions came with comments
   saying the item was in fact correct. Treat single scores as a guide, not ground truth.

In the app, every question has a **Report** button. A reported question stops counting toward the
score and the report reaches the diagnostics summary (no content). That remains the backstop for
anything that slips through.
