// SettingsProvider / useSetting / useSettingsService moved to @ksp-gonogo/core
// (2026-07-23) so Uplink clients can read a client-pref setting through the
// sitrep-sdk facade. Re-exported here for back-compat.
export {
  SettingsProvider,
  useSetting,
  useSettingsService,
} from "@ksp-gonogo/core";
