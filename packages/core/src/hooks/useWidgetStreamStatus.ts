/**
 * `useWidgetStreamStatus` moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * It resolves a widget's declared data requirements to one worst-case stream
 * status, which is what the dashboard's own widget chrome renders, so it had to be
 * reachable from `@ksp-gonogo/ui-kit`'s `renderWidget`: an Uplink's test renders a
 * widget the way the dashboard does, and neither ui-kit nor an Uplink can import
 * this package.
 *
 * It named the carried-topic gate, the topic mapper, the telemetry contexts and
 * `worstStatus`, every one of them already sdk-side.
 *
 * Re-exported so this package's importers keep their import site.
 */
export { useWidgetStreamStatus } from "@ksp-gonogo/sitrep-sdk/spine";
