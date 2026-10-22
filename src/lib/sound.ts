// Tiny feedback sounds (WebAudio, no files). Respects the user's sound setting.
let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch { return null; }
}
function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.07) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.02);
}
export type Sfx = "correct" | "wrong" | "done" | "tap";
export function playSfx(kind: Sfx, enabled: boolean): void {
  if (!enabled) return;
  if (kind === "correct") { tone(660, 0, 0.12); tone(880, 0.09, 0.18); }
  else if (kind === "wrong") { tone(220, 0, 0.22, "triangle", 0.09); tone(165, 0.12, 0.24, "triangle", 0.08); }
  else if (kind === "done") { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25)); }
  else tone(520, 0, 0.05, "sine", 0.04);
}
