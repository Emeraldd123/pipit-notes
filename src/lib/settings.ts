// User settings. Kept in localStorage (tiny, synchronous, readable before the DB
// opens). The Anthropic key never leaves the device except in direct requests to
// api.anthropic.com that the user triggers.
import { useSyncExternalStore } from "react";

export type Preset = { tool: "pencil" | "pen" | "highlighter" | "marker"; color: string; width: number };

export type Settings = {
  /** Anthropic API key for handwriting recognition, search answers, practice questions. */
  apiKey: string;
  /** Master switch: nothing is sent to an AI provider unless this is on. */
  aiEnabled: boolean;
  model: string;
  theme: "system" | "light" | "dark";
  /** Re-read changed pages in the background so search stays fresh. */
  autoIndex: boolean;
  /** Hold the pen still to snap rough lines/circles/rectangles into clean shapes. */
  shapeSnap: boolean;
  /** Keep a local, content-free diagnostics log (errors, timings, health). Never contains note content. */
  diagnostics: boolean;
  /** Also send content-free reports to the reporting endpoint so problems can be fixed. */
  reportEnabled: boolean;
  /** Reporting endpoint; empty = this site's own /.netlify/functions/diag. */
  reportUrl: string;
  /** Use the cheaper model for simple jobs (reading handwriting for search, follow-up chat, link explanations). */
  economy: boolean;
  economyModel: string;
  /** Think harder on everything (slower, costs more). */
  careful: boolean;
  /** Soft monthly cap on AI spend in USD (0 = no cap). */
  monthlyBudgetUsd: number;
  /** Which side of the screen the tool rail sits on (put it under your non-writing hand). */
  railSide: "left" | "right";
  /** Saved pen setups. */
  presets: Preset[];
  /** Custom colours picked recently (most recent first). */
  recentColors: string[];
  /** Scribbling back and forth over ink erases it (off by default — it can surprise you). */
  scribbleErase: boolean;
};

const KEY = "pipit-notes.settings.v1";
export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  aiEnabled: false,
  model: "claude-sonnet-5-5",
  theme: "system",
  autoIndex: false,
  shapeSnap: false,
  diagnostics: true,
  reportEnabled: true,
  reportUrl: "",
  economy: true,
  economyModel: "claude-haiku-5-5",
  careful: false,
  monthlyBudgetUsd: 0,
  railSide: "left",
  presets: [],
  recentColors: [],
  scribbleErase: false,
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
