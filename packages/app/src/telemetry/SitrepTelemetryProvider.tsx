import { PerfBudget } from "@gonogo/core";
import { logger } from "@gonogo/logger";
import {
  TelemetryClient,
  TelemetryProvider,
  type Transport,
  WebSocketTransport,
} from "@gonogo/sitrep-client";
import { type ReactNode, useEffect, useState } from "react";

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
  name: "Sitrep stream frames/sec",
  threshold: 750,
  windowMs: 1000,
  unit: "frames",
});

/**
 * Default dev-first per-topic promotion list (browser-transport brief §2/§3,
 * `m3-migration-plan.md` §5.1 carried-channels gate). These are the RAW wire
 * topics the mod's `VesselViewProvider`/`SystemViewProvider`/`TimeViewProvider`
 * are known to serve — the `useDataValue` shim resolves each mapped/derived
 * topic down to its raw wire inputs and only routes to the stream when EVERY
 * input is carried, so promotion is done at raw-topic granularity here.
 *
 * This is deliberately an explicit opt-in list rather than a hard-coded
 * transport declaration: the mod server does not yet advertise a channel list
 * on connect, so until it does, this dev list is how a topic is reliably
 * promoted to the stream. `WebSocketTransport` additionally marks channels
 * carried as their frames first arrive (best-effort fallback) — but that grows
 * too late to flip this gate for the current session, so it is informational
 * only for now.
 */
export const DEFAULT_SITREP_CARRIED_TOPICS: readonly string[] = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "vessel.control",
  "vessel.comms",
  // R6 shared-derivations: source of the client-derived `vessel.state.twr`
  // (old `dv.currentTWR`) — a declared input of `vesselStateChannel`, so it
  // must be carried for ANY `vessel.state.*` field to resolve (the gate is
  // parent-channel-scoped).
  "vessel.propulsion",
  "vessel.attitude",
  "vessel.thermal",
  "vessel.structure",
  "vessel.crew",
  "vessel.resources",
  "vessel.target",
  "vessel.maneuver",
  "vessel.dock",
  "vessel.surface",
  "system.bodies",
  "system.vessels",
  "time.warp",
  // Comms signal-delay channel (CommsCoreUplink, TrueNow) — the headline
  // delay readout behind CommSignal's comm.signalDelay.
  "comms.delay",
  // U3 kOS slice: native push channel for the KosProcessors widget. Static
  // raw topic, so `isTopicCarried` promotes it by simple set membership. The
  // dynamic `kos.compute.<id>.<field>` namespace is intentionally NOT here —
  // those strings aren't known up front and need a prefix/glob extension to
  // the carried gate (deferred to the compute-feed slice).
  "kos.processors",
];

/** `true` when the dev streaming flag is set in the build env (dev channel first — hard-cut for release). */
export function isSitrepStreamEnabled(): boolean {
  return import.meta.env.VITE_SITREP_STREAM === "true";
}

export interface SitrepTelemetryProviderProps {
  children: ReactNode;
  /** Overrides the env flag (used by tests). Defaults to `isSitrepStreamEnabled()`. */
  enabled?: boolean;
  /** Mod host (default from `VITE_SITREP_HOST`, then `localhost`). */
  host?: string;
  /** Mod port (default from `VITE_SITREP_PORT`, then 8090). */
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
 * server — behind the `VITE_SITREP_STREAM` dev flag. When the flag is off (the
 * release default) this renders `children` untouched, so the app behaves
 * exactly as it does today and every widget stays on the legacy Telemachus
 * `DataSource`.
 *
 * When on, the `useDataValue` shim (`@gonogo/core`) automatically routes any
 * MAPPED + CARRIED topic through the streaming pipeline with zero widget
 * changes; everything else keeps falling back to legacy. Main-screen only —
 * the station screen gets stream data over PeerJS in a later task and must not
 * mount this.
 */
export function SitrepTelemetryProvider({
  children,
  enabled = isSitrepStreamEnabled(),
  host,
  port,
  carriedChannels = DEFAULT_SITREP_CARRIED_TOPICS,
  transport: injectedTransport,
}: SitrepTelemetryProviderProps) {
  const resolvedHost = host ?? import.meta.env.VITE_SITREP_HOST ?? "localhost";
  const resolvedPort =
    port ?? (Number(import.meta.env.VITE_SITREP_PORT) || 8090);

  // The transport opens its WebSocket in its constructor — a side effect — and
  // the client/transport are disposable resources. Building them in `useEffect`
  // (not `useMemo`) ties their lifecycle to the effect: StrictMode's
  // mount→unmount→remount disposes the first socket in the cleanup and builds a
  // FRESH one on re-setup, instead of leaving the memo pinned to a disposed
  // transport (which silently strands the whole live stream — the socket never
  // reconnects and no frame ever arrives).
  const [client, setClient] = useState<TelemetryClient | null>(null);

  useEffect(() => {
    if (!enabled) {
      setClient(null);
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
      ownedTransport?.dispose();
      setClient(null);
    };
  }, [enabled, resolvedHost, resolvedPort, injectedTransport]);

  if (!client) return <>{children}</>;

  return (
    <TelemetryProvider client={client} carriedChannels={carriedChannels}>
      {children}
    </TelemetryProvider>
  );
}
