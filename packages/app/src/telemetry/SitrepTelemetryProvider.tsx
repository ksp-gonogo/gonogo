import { PerfBudget } from "@gonogo/core";
import { logger } from "@gonogo/logger";
import {
  TelemetryClient,
  TelemetryProvider,
  type Transport,
  WebSocketTransport,
} from "@gonogo/sitrep-client";
import { type ReactNode, useEffect, useMemo } from "react";

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
  "vessel.attitude",
  "vessel.thermal",
  "vessel.structure",
  "vessel.crew",
  "vessel.resources",
  "vessel.target",
  "vessel.maneuver",
  "vessel.dock",
  "system.bodies",
  "system.vessels",
  "time.warp",
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

  const mounted = useMemo(() => {
    if (!enabled) return null;
    const transport =
      injectedTransport ??
      new WebSocketTransport({
        host: resolvedHost,
        port: resolvedPort,
        onStreamFrame: () => SITREP_STREAM_BUDGET.record(),
      });
    logger.tag("sitrep").info("live stream transport mounted", {
      host: resolvedHost,
      port: resolvedPort,
      injected: injectedTransport !== undefined,
    });
    // Own the WebSocketTransport's lifecycle; an injected transport is the
    // caller's to dispose.
    const ownsTransport = injectedTransport === undefined;
    return {
      client: new TelemetryClient(transport),
      transport: transport as WebSocketTransport,
      ownsTransport,
    };
  }, [enabled, resolvedHost, resolvedPort, injectedTransport]);

  useEffect(() => {
    if (!mounted) return;
    return () => {
      mounted.client.dispose();
      if (mounted.ownsTransport) mounted.transport.dispose();
    };
  }, [mounted]);

  if (!mounted) return <>{children}</>;

  return (
    <TelemetryProvider
      client={mounted.client}
      carriedChannels={carriedChannels}
    >
      {children}
    </TelemetryProvider>
  );
}
