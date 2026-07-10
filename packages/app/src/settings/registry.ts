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
