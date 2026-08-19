/**
 * The Settings-tab registry moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * Registering a tab is published as a shim, so an Uplink could add one and then had
 * no supported way to read back or reset what it had added. It named `Screen` and
 * React, and `Screen` moved in the same change.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  __clearSettingsTabsForTests,
  getSettingsTabs,
  getSettingsTabsForScreen,
  registerSettingsTab,
  type SettingsTabDefinition,
} from "@ksp-gonogo/sitrep-sdk/spine";
