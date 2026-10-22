// Spaced repetition scheduling (SM-2 flavoured). Pure + unit-tested.
export type Grade = 0 | 1 | 2 | 3; // again, hard, good, easy
export type SrsState = {
  /** when the card is next due (ms epoch) */
  due: number;
  /** current gap in days (fractional while learning) */
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  lastReviewed?: number;
};

const DAY = 86_400_000;
export const GRADE_LABELS = ["Again", "Hard", "Good", "Easy"] as const;

export const newSrs = (now = Date.now()): SrsState => ({ due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 });

export function schedule(s: SrsState, grade: Grade, now = Date.now()): SrsState {
  let { interval, ease, reps, lapses } = s;
  if (grade === 0) {
    if (reps > 0) lapses++;
    ease = Math.max(1.3, ease - 0.2);
    return { due: now + 10 * 60_000, interval: 0, ease, reps: 0, lapses, lastReviewed: now };
  }
  if (grade === 1) {
    ease = Math.max(1.3, ease - 0.15);
    interval = reps === 0 ? 0.25 : Math.max(1, interval * 1.2);
  } else if (grade === 2) {
    interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(interval * ease);
    reps++;
  } else {
    ease += 0.15;
    interval = reps === 0 ? 3 : reps === 1 ? 6 : Math.round(interval * ease * 1.3);
    reps++;
  }
  interval = Math.min(365, interval);
  return { due: now + interval * DAY, interval, ease, reps, lapses, lastReviewed: now };
}

export const isDue = (s: SrsState, now = Date.now()) => s.reps > 0 && s.due <= now;
export const isNew = (s: SrsState) => s.reps === 0 && !s.lastReviewed;

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
export const crownOf = (s: SrsState) => (s.reps === 0 ? 0 : CROWN_AT.filter((d) => s.interval >= d).length);
/** 0..1 mastery */
export const mastery = (s: SrsState) => crownOf(s) / 5;
