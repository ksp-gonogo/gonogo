import { useDataSources } from "./useDataSources";

/**
 * The shared "No telemetry host" string — used identically by the widget
 * chrome (`RequiresGuard`) and the Settings Data Sources tab
 * (`UplinkHealthList`), per the uplink-health render-gating design's "same
 * string in both surfaces" rule (local_docs/uplink-health-render-gating-design.md).
 */
export const NO_TELEMETRY_HOST_MESSAGE = "No telemetry host";

/**
 * True when the `sitrep` `DataSource` (the Gonogo/Sitrep WebSocket, the
 * app's sole telemetry source) is not connected — "disconnected", "error",
 * or not registered at all (pre-boot). `"reconnecting"` reports NOT down:
 * it's a transient, still-recoverable blip, not a confirmed loss — the
 * same distinction `useDataStreamStatus`'s `legacyToStreamStatus` already
 * draws (`"reconnecting"` -> `"held-stale"`, not `"disconnected"`).
 */
export function useTelemetryHostDown(): boolean {
  const dataSources = useDataSources();
  const sitrep = dataSources.find((s) => s.id === "sitrep");
  if (!sitrep) return true;
  return sitrep.status === "disconnected" || sitrep.status === "error";
}
