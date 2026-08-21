// The settings-definition registry moved to @ksp-gonogo/core (2026-07-23) so
// Uplink clients can declare settings through the sitrep-sdk facade, alongside
// `registerSettingsTab`. Re-exported here for back-compat.
//
// Note the rename: core's setting-def lookup is `getSettingDefinition` (not
// `getSetting`, which core already uses for its string-valued settings store,
// see core's `settings/store.ts`).
export {
  __clearSettingsForTests,
  type ClientPrefSetting,
  type ClientPrefSettingOf,
  getAllSettings,
  getSettingDefinition,
  getSettingsForScreen,
  isReadOnlySetting,
  registerSetting,
  type SettingDefinition,
  type SettingDefinitionBase,
  type SettingDefinitionOf,
  type SettingType,
  type SettingValue,
  type SettingValueByType,
  type SourceBackedSetting,
  type SourceBackedSettingOf,
  type StreamBackedSetting,
  type StreamBackedSettingOf,
  settingTypeOf,
} from "@ksp-gonogo/core";
