import { PerfBudget } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import {
  DEFAULT_SITREP_CARRIED_TOPICS,
  TelemetryClient,
  TelemetryProvider,
  type Transport,
  WebSocketTransport,
} from "@ksp-gonogo/sitrep-client";
import {
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getSitrepHostConfig,
  getSitrepReconnectNonce,
  reportSitrepTransportStatus,
  subscribeSitrepHostConfig,
  subscribeSitrepReconnectNonce,
} from "./sitrepRuntime";

/**
 * Soft cap on `stream-data` frames delivered off the live Sitrep WebSocket
 * (the repo mandates a sample/dispatch-rate `PerfBudget` per data source; the
 * streaming ingest had none).
 *
 * **Metric choice — frames/sec, not wire-bytes.** The mod's channel engine is
 * change-gated + keyframed, so BOTH byte volume and frame count are bursty on
 * keyframe boundaries; neither is smooth. Frame count is picked because the
 * three regressions a budget must catch here — a runaway server tick rate, a
 * duplicated subscription (same topic fanned twice), and a reconnect storm
 * re-sending every keyframe — all show up directly as excess FRAMES, whereas a
 * byte budget would also trip on a legitimately large one-off keyframe payload
 * (a big `system.bodies`/parts snapshot) that isn't a rate problem at all.
 *
 * **Threshold.** Steady state across the ~15 carried channels at their mixed
 * cadences (vessel.orbit ~1 Hz, most others slower, occasional keyframes) sits
 * comfortably under ~150 frames/sec even under warp catch-up bursts. 750
 * leaves ~5x headroom — tight enough to flag a runaway/duplicated stream,
 * loose enough to absorb a normal keyframe burst.
 */
const SITREP_STREAM_BUDGET = new PerfBudget({
  name: "Telemetry stream frames/sec",
  threshold: 750,
  windowMs: 1000,
  unit: "frames",
});

/**
 * Re-exported for backward compatibility — every existing call site
 * (`StationScreen`, `SitrepPeerRelay`, this file's own default prop, tests)
 * imports it from here. The list itself now lives in
 * `@ksp-gonogo/sitrep-client` (`default-carried-topics.ts`) so
 * `@ksp-gonogo/data`'s `useDataSchema("data")` catalog builder can read the
 * exact same source of truth without `data` depending on `app` (see that
 * file's doc comment for why).
 */
export { DEFAULT_SITREP_CARRIED_TOPICS };

export interface SitrepTelemetryProviderProps {
  children: ReactNode;
  /**
   * The stream is on by default — the mod is the app's only telemetry
   * source since the legacy Telemachus `DataSource` was deleted (`806e7fe2`).
   * This only exists as a test/embedding seam (e.g. asserting the
   * "disabled" fallback still renders `children` untouched); nothing in the
   * app itself passes `false`.
   */
  enabled?: boolean;
  /**
   * Overrides the runtime host (Data Sources panel config, `KSP_HOST` seed,
   * or `VITE_SITREP_HOST`/`localhost` build default — see `sitrepRuntime.ts`).
   * Tests pass this directly; production code leaves it unset so panel
   * edits take effect live.
   */
  host?: string;
  /** Overrides the runtime port the same way `host` does. */
  port?: number;
  /** Carried-channels promotion list (default `DEFAULT_SITREP_CARRIED_TOPICS`). */
  carriedChannels?: readonly string[];
  /**
   * Inject the transport instead of building a `WebSocketTransport` from
   * host/port — for tests that drive the mount with a scriptable `Transport`
   * (e.g. `StubTransport`), or for future alternate transports. When omitted,
   * a live `WebSocketTransport` to the mod host/port is built.
   */
  transport?: Transport;
}

/**
 * Mounts a live `<TelemetryProvider>` fed by a `WebSocketTransport` to the mod
 * server — ON BY DEFAULT. The legacy Telemachus `DataSource` was deleted in
 * `806e7fe2` (R6 cutover), so this is now the app's ONLY telemetry source;
 * there is no dev flag gating it and no fallback to fall back to.
 *
 * Host/port are runtime-configurable, not just build-time env vars: they
 * come from `sitrepRuntime.ts`, which layers a saved Data Sources panel
 * config (see `../dataSources/sitrep.ts`) over a `KSP_HOST` bundle seed
 * (`../dataSources/seedKspHost.ts`) over `VITE_SITREP_HOST`/`_PORT` build
 * defaults. Editing the panel's Host/Port fields reconnects the live
 * transport immediately — no rebuild, no restart.
 *
 * The `useDataValue` shim (`@ksp-gonogo/core`) automatically routes any
 * MAPPED + CARRIED topic through the streaming pipeline with zero widget
 * changes. Mounted on both screens: the main screen builds its own
 * `WebSocketTransport` here (the default, unset-`transport` path below);
 * the station screen injects a `PeerTransport`
 * (`packages/app/src/telemetry/PeerTransport.ts`) fed by `SitrepPeerRelay`'s
 * forwarded frames instead — see `StationScreen.tsx`.
 */
export function SitrepTelemetryProvider({
  children,
  enabled = true,
  host,
  port,
  carriedChannels = DEFAULT_SITREP_CARRIED_TOPICS,
  transport: injectedTransport,
}: SitrepTelemetryProviderProps) {
  const liveHostConfig = useSyncExternalStore(
    subscribeSitrepHostConfig,
    getSitrepHostConfig,
    getSitrepHostConfig,
  );
  const reconnectNonce = useSyncExternalStore(
    subscribeSitrepReconnectNonce,
    getSitrepReconnectNonce,
    getSitrepReconnectNonce,
  );
  const resolvedHost = host ?? liveHostConfig.host;
  const resolvedPort = port ?? liveHostConfig.port;

  // The transport opens its WebSocket in its constructor — a side effect — and
  // the client/transport are disposable resources. Building them in `useEffect`
  // (not `useMemo`) ties their lifecycle to the effect: StrictMode's
  // mount→unmount→remount disposes the first socket in the cleanup and builds a
  // FRESH one on re-setup, instead of leaving the memo pinned to a disposed
  // transport (which silently strands the whole live stream — the socket never
  // reconnects and no frame ever arrives).
  const [client, setClient] = useState<TelemetryClient | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reconnectNonce has no direct use in the body — bumping it (the panel's Reconnect action, once the transport has given up) must force this effect to tear down and rebuild even when host/port are unchanged.
  useEffect(() => {
    if (!enabled) {
      setClient(null);
      reportSitrepTransportStatus("disconnected");
      return;
    }
    // An injected transport is the caller's to dispose (tests own its lifecycle);
    // a WebSocketTransport we build here is ours.
    const ownsTransport = injectedTransport === undefined;
    const ownedTransport = ownsTransport
      ? new WebSocketTransport({
          host: resolvedHost,
          port: resolvedPort,
          onStreamFrame: () => SITREP_STREAM_BUDGET.record(),
        })
      : undefined;
    // Mirror the OWNED transport's connection status into the "Sitrep
    // Stream" Data Sources panel row — an injected test transport has no
    // bearing on what that panel should report about the real connection.
    const unsubStatus = ownedTransport?.onStatusChange(
      reportSitrepTransportStatus,
    );
    if (ownedTransport) reportSitrepTransportStatus(ownedTransport.status);
    const transport = injectedTransport ?? ownedTransport;
    const telemetryClient = new TelemetryClient(transport as Transport);
    logger.tag("sitrep").info("live stream transport mounted", {
      host: resolvedHost,
      port: resolvedPort,
      injected: injectedTransport !== undefined,
    });
    setClient(telemetryClient);
    return () => {
      telemetryClient.dispose();
      unsubStatus?.();
      ownedTransport?.dispose();
      setClient(null);
    };
  }, [enabled, resolvedHost, resolvedPort, injectedTransport, reconnectNonce]);

  if (!client) return <>{children}</>;

  return (
    <TelemetryProvider client={client} carriedChannels={carriedChannels}>
      {children}
    </TelemetryProvider>
  );
}
