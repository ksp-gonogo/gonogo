import type { ComponentType } from "react";
import type { Screen } from "./contexts/ScreenContext";

/**
 * Global registry of full custom Settings-modal tabs. Mirrors the
 * `registerSetting` pattern for individual boolean settings — an Uplink
 * co-locates a whole tab's registration with the code that owns it, and
 * `SettingsModal` renders whatever's registered, generically, with no
 * per-mod knowledge.
 */
export interface SettingsTabDefinition {
  /** Stable id — React key and tab id. */
  id: string;
  /** Tab label shown in the Settings modal's tab strip. */
  label: string;
  /** The tab's content, rendered with no props. */
  component: ComponentType;
  /** Which screens this tab appears on. Omit for both. */
  screens?: readonly Screen[];
}

const tabs = new Map<string, SettingsTabDefinition>();

/** Register (or replace) a Settings-modal tab. Last write wins per id. */
export function registerSettingsTab(def: SettingsTabDefinition): void {
  tabs.set(def.id, def);
}

/** Every registered tab, in registration order. */
export function getSettingsTabs(): SettingsTabDefinition[] {
  return [...tabs.values()];
}

/** Tabs applicable to `screen` — no `screens` means "both". */
export function getSettingsTabsForScreen(
  screen: Screen,
): SettingsTabDefinition[] {
  return getSettingsTabs().filter(
    (t) => !t.screens || t.screens.includes(screen),
  );
}

/** For use in tests only — resets the registry to empty. */
export function __clearSettingsTabsForTests(): void {
  tabs.clear();
}
