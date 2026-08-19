/**
 * The settings registry moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * Declaring a setting row is the PREFERRED way an Uplink surfaces one, so the
 * registry an Uplink's test reads back has to be reachable from a published
 * package. It named `Screen` and nothing else, and `Screen` moved in the same
 * change.
 *
 * Re-exported so this package's importers keep their import site. Named one by
 * one rather than starred: this module is re-exported from the package index, and
 * a star would put the whole spine barrel on `@ksp-gonogo/core`'s surface through
 * a path that means "settings".
 */
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
} from "@ksp-gonogo/sitrep-sdk/spine";
