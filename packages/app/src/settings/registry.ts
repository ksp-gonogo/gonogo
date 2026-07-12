import type { Screen } from "@ksp-gonogo/core";

/**
 * Global registry of user-facing settings. Mirrors the `registerComponent`
 * pattern — features co-locate their own setting definition with the code
 * that consumes it, and `SettingsModal` renders whatever's registered.
 */

export type SettingType = "boolean";

export interface SettingDefinitionBase {
  id: string;
  label: string;
  description?: string;
  category: string;
  /** Which screens this setting is relevant on. Omit for both. */
  screens?: readonly Screen[];
  /**
   * Id of a parent BOOLEAN setting this one is nested under. Purely a
   * RENDERING/inertness hint for `SettingsModal` (indents the row, disables
   * its `Switch`, and shows it as off, whenever the parent setting reads
   * `false`) — the registry itself has no hierarchy concept beyond this one
   * pointer, and does NOT enforce the dependency for consumers reading the
   * child setting directly via `useSetting`. A consuming hook that wants the
   * dependency enforced at the DATA level (not just the UI) must AND-combine
   * both values itself (mirrors `useStationWakeLock`'s own
   * `active && enabled` pattern) — see `useMissionHistorySettings` for the
   * concrete example this field was added for.
   */
  dependsOn?: string;
}

export interface BooleanSetting extends SettingDefinitionBase {
  type: "boolean";
  defaultValue: boolean;
}

export type SettingDefinition = BooleanSetting;

const registry = new Map<string, SettingDefinition>();

export function registerSetting(def: SettingDefinition): void {
  // Idempotent — hot module reload can re-execute registration modules.
  registry.set(def.id, def);
}

export function getSetting(id: string): SettingDefinition | undefined {
  return registry.get(id);
}

export function getAllSettings(): SettingDefinition[] {
  return [...registry.values()];
}

export function getSettingsForScreen(screen: Screen): SettingDefinition[] {
  return getAllSettings().filter(
    (s) => !s.screens || s.screens.includes(screen),
  );
}

export function __clearSettingsForTests(): void {
  registry.clear();
}
