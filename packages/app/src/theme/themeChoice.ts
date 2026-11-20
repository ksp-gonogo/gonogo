import { getTheme, getThemes, type ThemeDefinition } from "@ksp-gonogo/core";
import { useSyncExternalStore } from "react";

/** The theme every screen starts with. */
export const DEFAULT_THEME_ID = "default-dark";

const STORAGE_KEY = "gonogo.theme";

const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The id of the theme this device chose, or the default when it chose none or
 * the one it chose is not registered. Each device keeps its own choice, so a
 * station never follows the main screen's.
 */
export function chosenThemeId(): string {
  const stored = storage()?.getItem(STORAGE_KEY);
  return stored && getTheme(stored) ? stored : DEFAULT_THEME_ID;
}

/** The registered themes, default first, then in the order they registered. */
export function themeChoices(): ThemeDefinition[] {
  const all = getThemes();
  return [
    ...all.filter((t) => t.id === DEFAULT_THEME_ID),
    ...all.filter((t) => t.id !== DEFAULT_THEME_ID),
  ];
}

/** Keep `id` as this device's theme and switch every mounted screen to it. */
export function chooseTheme(id: string): void {
  if (!getTheme(id)) return;
  try {
    storage()?.setItem(STORAGE_KEY, id);
  } catch {
    // A full or blocked store only means the choice does not outlive the page.
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The id of this device's theme, re-read when {@link chooseTheme} changes it. */
export function useChosenThemeId(): string {
  return useSyncExternalStore(subscribe, chosenThemeId, () => DEFAULT_THEME_ID);
}
