/**
 * The shared settings store moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * `setSetting` and `subscribeSetting` were already published as host shims, because
 * `gameHost` has to have ONE answer: two copies of this store is not a degraded
 * experience, it is an Uplink dialling a host the app never saw.
 * `resetSettingsForTests` was not published, so an Uplink's test could not clear
 * the store between cases without importing this package, which is `private: true`.
 *
 * It named nothing at all, so nothing was holding it here.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  getSetting,
  resetSettingsForTests,
  seedSetting,
  setSetting,
  subscribeSetting,
} from "@ksp-gonogo/sitrep-sdk";
