// User settings. Kept in localStorage (tiny, synchronous, readable before the DB
// opens). The Anthropic key never leaves the device except in direct requests to
// api.anthropic.com that the user triggers.
import { useSyncExternalStore } from "react";

export type Settings = {
  /** Anthropic API key for handwriting recognition, search answers, practice questions. */
  apiKey: string;
  /** Master switch: nothing is sent to an AI provider unless this is on. */
  aiEnabled: boolean;
  model: string;
  theme: "system" | "light" | "dark";
  /** Re-read changed pages in the background so search stays fresh. */
  autoIndex: boolean;
};

const KEY = "pipit-notes.settings.v1";
export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  aiEnabled: false,
  model: "claude-sonnet-5",
  theme: "system",
  autoIndex: false,
};

let cache: Settings | null = null;
const listeners = new Set<() => void>();

function read(): Settings {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache!;
}

export function getSettings(): Settings {
  return read();
}

export function updateSettings(patch: Partial<Settings>): void {
  cache = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable */
  }
  applyTheme(cache.theme);
  listeners.forEach((l) => l());
}

export function applyTheme(theme: Settings["theme"]): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    read
  );
}

/** True when AI features are switched on AND a key is present. */
export function aiReady(s: Settings = read()): boolean {
  return s.aiEnabled && s.apiKey.trim().length > 10;
}
