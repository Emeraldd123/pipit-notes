// Stable id for a freshly-created record (crypto.randomUUID with a fallback).
export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* older webview */
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
export const newStrokeId = newId;
