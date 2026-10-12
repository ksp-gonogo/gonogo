import type { ComponentType } from "react";
import type { Screen } from "./screen";

/**
 * A whole custom tab of the settings panel. Useful for an Uplink that needs a
 * settings interface a declarative row cannot express. Taken by
 * {@link registerSettingsTab}, and drawn by the settings panel with no knowledge
 * of which Uplink supplied it.
 *
 * Prefer {@link registerSetting}: declarative rows render and persist with no
 * bespoke interface. Use a whole tab only when a setting's interface cannot be a
 * row.
 */
export interface SettingsTabDefinition {
  /** Stable id: React key and tab id. */
  id: string;
  /** Tab label shown in the Settings modal's tab strip. */
  label: string;
  /** The tab's content, rendered with no props. */
  component: ComponentType;
  /** Which screens this tab appears on. Omit for every screen. */
  screens?: readonly Screen[];
  /**
   * The Uplink this tab belongs to, by its id. The Settings window has an
   * Uplinks tab with a page for each Uplink; with this set, the tab is drawn
   * as a section of that Uplink's page, titled `label`, rather than as a tab
   * of its own.
   */
  uplink?: string;
}

const tabs = new Map<string, SettingsTabDefinition>();

/**
 * Registers (or replaces) a settings panel tab. Useful for an Uplink to put a
 * whole tab of its own settings in front of the operator, next to the code that
 * owns it. Used by the app's Uplink host. The last registration for an id wins.
 */
export function registerSettingsTab(def: SettingsTabDefinition): void {
  tabs.set(def.id, def);
}

/**
 * Every registered settings tab, in registration order. Useful for listing all
 * tabs regardless of screen.
 */
export function getSettingsTabs(): SettingsTabDefinition[] {
  return [...tabs.values()];
}

/**
 * The settings tabs that apply to `screen`; a tab with no `screens` applies to
 * both. Useful for showing the operator only the tabs that make sense on the
 * screen they are using. Used by the settings panel.
 */
export function getSettingsTabsForScreen(
  screen: Screen,
): SettingsTabDefinition[] {
  return getSettingsTabs().filter(
    (t) => !t.screens || t.screens.includes(screen),
  );
}

/** For use in tests only, resets the registry to empty. */
export function __clearSettingsTabsForTests(): void {
  tabs.clear();
}
