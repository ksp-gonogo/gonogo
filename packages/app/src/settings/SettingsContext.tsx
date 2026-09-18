// SettingsProvider / useSetting / useSettingsService live in @ksp-gonogo/core
// so Uplink clients can read a client-pref setting through the sitrep-sdk
// facade. Re-exported here for back-compat.
export {
  SettingsProvider,
  useSetting,
  useSettingsService,
} from "@ksp-gonogo/core";
