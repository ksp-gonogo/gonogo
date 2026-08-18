// Re-export shim: `Gauge` moved to `@ksp-gonogo/ui-kit` so an Uplink can render
// one. It is purely presentational and imports nothing but React, so it belonged
// on the published floor all along, and an Uplink widget was reaching into this
// private package for it. Every `@ksp-gonogo/ui` importer stays byte-identical.
export { Gauge, type GaugeProps, type GaugeZone } from "@ksp-gonogo/ui-kit";
