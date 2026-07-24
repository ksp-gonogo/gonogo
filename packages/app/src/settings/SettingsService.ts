// SettingsService moved to @ksp-gonogo/core (2026-07-23) so Uplink clients can
// reach the same persistence layer through the sitrep-sdk facade. Re-exported
// here for back-compat — every existing app import path keeps working.
export { SettingsService } from "@ksp-gonogo/core";
