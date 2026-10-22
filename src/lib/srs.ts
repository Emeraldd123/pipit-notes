// Spaced repetition scheduling: FSRS-5 (the scheduler Anki moved to), with its published default
// parameters. It models how stable a memory is and how hard the card is, and schedules the next review for
// when you're predicted to still remember it with 90% probability — fewer reviews for the same retention
// than the older SM-2 rules. Pure + unit-tested.
export type Grade = 0 | 1 | 2 | 3; // again, hard, good, easy
export type SrsState = {
  /** when the card is next due (ms epoch) */
  due: number;
  /** days until the next review (0 while relearning) */
  interval: number;
  /** legacy SM-2 ease, kept so older cards migrate smoothly */
  ease: number;
  /** total reviews */
  reps: number;
  lapses: number;
  lastReviewed?: number;
  /** FSRS memory state */
  stability?: number;
  difficulty?: number;
};

const DAY = 86_400_000;
const RELEARN_MS = 10 * 60_000;
export const GRADE_LABELS = ["Again", "Hard", "Good", "Easy"] as const;
export const DESIRED_RETENTION = 0.9;

/** FSRS-5 default parameters (open-spaced-repetition). */
export const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5;
const FACTOR = 19 / 81;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Probability of recalling after `days` given stability S (0.9 when days == S). */
export const retrievability = (days: number, S: number) => Math.pow(1 + (FACTOR * days) / S, DECAY);
/** Days until recall probability falls to `r`. */
export const intervalFor = (S: number, r = DESIRED_RETENTION) => (S / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);
const initD = (G: number) => clamp(W[4] - Math.exp(W[5] * (G - 1)) + 1, 1, 10);
function nextD(D: number, G: number): number {
  const delta = -W[6] * (G - 3);
  const damped = D + (delta * (10 - D)) / 9;                     // linear damping: hard cards move slowly
  return clamp(W[7] * initD(4) + (1 - W[7]) * damped, 1, 10);    // mean reversion
}
function recallS(D: number, S: number, R: number, G: number): number {
  const hard = G === 2 ? W[15] : 1, easy = G === 4 ? W[16] : 1;
  return S * (Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9]) * (Math.exp(W[10] * (1 - R)) - 1) * hard * easy + 1);
}
function forgetS(D: number, S: number, R: number): number {
  return Math.min(S, W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R)));
}

export const newSrs = (now = Date.now()): SrsState => ({ due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 });

/** Cards scheduled by the old SM-2 rules get an equivalent FSRS state. */
export function memoryOf(s: SrsState): { S: number; D: number } {
  const S = s.stability ?? Math.max(0.5, s.interval || 0.5);
  const D = s.difficulty ?? clamp(11 - ((s.ease - 1.3) / 1.7) * 9, 1, 10);
  return { S, D };
}

export function schedule(s: SrsState, grade: Grade, now = Date.now()): SrsState {
  const G = grade + 1;
  let S: number, D: number;
  if (s.lastReviewed === undefined) {
    S = W[G - 1];
    D = initD(G);
  } else {
    const m = memoryOf(s);
    const days = Math.max(0, (now - s.lastReviewed) / DAY);
    if (days < 1) S = m.S * Math.exp(W[17] * (G - 3 + W[18]));   // reviewed again the same day
    else {
      const R = retrievability(days, m.S);
      S = G === 1 ? forgetS(m.D, m.S, R) : recallS(m.D, m.S, R, G);
    }
    D = nextD(m.D, G);
  }
  S = clamp(S, 0.05, 36500);
  const interval = G === 1 ? 0 : clamp(Math.round(intervalFor(S)), 1, 365);
  return {
    due: G === 1 ? now + RELEARN_MS : now + interval * DAY,
    interval, ease: s.ease, reps: s.reps + 1, lapses: s.lapses + (G === 1 && s.lastReviewed !== undefined ? 1 : 0),
    lastReviewed: now, stability: S, difficulty: D,
  };
}

/** Reviewed before and its time has come (cards you just got wrong come back after 10 minutes). */
export const isDue = (s: SrsState, now = Date.now()) => s.lastReviewed !== undefined && s.due <= now;
export const isNew = (s: SrsState) => s.lastReviewed === undefined;

/** What the next interval would be for each grade — shown on the buttons ("Good · 3d"). */
export function previewIntervals(s: SrsState, now = Date.now()): string[] {
  return ([0, 1, 2, 3] as Grade[]).map((g) => formatInterval(schedule(s, g, now).due - now));
}
export function formatInterval(ms: number): string {
  const m = ms / 60_000;
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return "1y+";
}

const CROWN_AT = [1, 3, 7, 14, 30];
/** 0–5 "crowns" for how well a card is known (by how far apart its reviews have been pushed). */
export const crownOf = (s: SrsState) => (s.lastReviewed === undefined ? 0 : CROWN_AT.filter((d) => s.interval >= d).length);
/** 0..1 mastery */
export const mastery = (s: SrsState) => crownOf(s) / 5;
