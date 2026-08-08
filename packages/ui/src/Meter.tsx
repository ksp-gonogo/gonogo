/**
 * `Meter` lives in `@ksp-gonogo/ui-kit`, the published package, so a facade-
 * sealed Uplink widget can reach it (an Uplink can import ui-kit but never this
 * app-side `@ksp-gonogo/ui`). This file is the app-side alias so both import
 * names resolve to the one component, the same split-and-alias pattern as
 * `Panel`.
 *
 * Add nothing here. A Meter part added in this file would be invisible to
 * Uplinks, which is the whole reason the source moved to ui-kit.
 */
export {
  Meter,
  type MeterProps,
  type MeterSize,
  MeterStack,
  type MeterTone,
} from "@ksp-gonogo/ui-kit";
