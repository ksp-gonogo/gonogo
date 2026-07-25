// The settings-definition registry moved to @ksp-gonogo/core (2026-07-23) so
// Uplink clients can declare settings through the sitrep-sdk facade, alongside
// `registerSettingsTab`. Re-exported here for back-compat.
//
// Note the rename: core's setting-def lookup is `getSettingDefinition` (not
// `getSetting`, which core already uses for its string-valued settings store —
// see core's `settings/store.ts`).
export {
  __clearSettingsForTests,
  type ClientPrefSetting,
  getAllSettings,
  getSettingDefinition,
  getSettingsForScreen,
  registerSetting,
  type SettingDefinition,
  type SettingDefinitionBase,
  type SettingType,
  type SourceBackedSetting,
} from "@ksp-gonogo/core";
