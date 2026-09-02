// #6, station boot re-sequence: a station gets EVERYTHING from the main
// screen over PeerJS and NEVER talks to KSP or an Uplink author host
// directly. `main.tsx` skips the roster probe + fetch-based loader entirely
// on `/station` (see its own doc comment), this file runs the equivalent
// sequence LATER, once the station has actually connected to a host and has
// its own peer-backed `TelemetryClient` (to read `system.uplinks` off) and
// `PeerClientService` (to route bundle-byte fetches through the D6 conduit,
// `createPeerBundleFetcher`).
//
// Mounted inside `StationScreen`'s connected branch, as a child of
// `<SitrepTelemetryProvider>` (so `useTelemetryClientOptional()` resolves to
// the live peer client) and of `<PeerClientProvider>` (so `usePeerClient()`
// resolves too). Wraps the Dashboard subtree specifically, the component
// registry is NOT reactive to a late `registerComponent` call (only data
// sources notify), so the widgets this loader registers must finish loading
// BEFORE the Dashboard that renders them mounts, exactly mirroring how
// main.tsx runs its loader before `renderApp()`.

import { logger } from "@ksp-gonogo/logger";
import {
  type TelemetryClient,
  useTelemetryClientOptional,
} from "@ksp-gonogo/sitrep-client";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { usePeerClient } from "../peer/PeerClientContext";
import { VERSION } from "../version";
import { loaderBootIdsOverride } from "./flag";
import { hostCompat } from "./hostCompat";
import { loadEnabledUplinks } from "./loader";
import type { UplinkLoadOutcome } from "./loaderState";
import {
  type BundleFetchConduit,
  createPeerBundleFetcher,
} from "./peerBundleFetch";
import { localRegistrySource } from "./registry";
import { readRosterFromTelemetryClient } from "./rosterProbe";

/**
 * Run the station's equivalent of `main.tsx`'s boot-time loader sequence,
 * but sourced entirely through the peer conduit instead of direct network
 * calls: read `system.uplinks` off the ALREADY-CONNECTED peer
 * `TelemetryClient` (never a new transport: see
 * `readRosterFromTelemetryClient`'s own doc comment), then load the
 * first-party Uplink set with `fetchBytes` routed through
 * `createPeerBundleFetcher` (the host verifies + relays bundle bytes,
 * `PeerHostService.handleUplinkBundleRequest`) instead of a direct `fetch`.
 *
 * Pure orchestration, no React: `StationUplinkLoader` below is the only
 * caller in production, but keeping this a plain async function makes the
 * wiring itself (roster read -> loadEnabledUplinks -> conduit fetchBytes)
 * unit-testable with fakes and no component tree.
 */
export async function runStationUplinkLoad(
  telemetryClient: TelemetryClient,
  bundleFetchConduit: BundleFetchConduit,
  rosterTimeoutMs?: number,
  /**
   * Overrides `LoaderContext.importBundle`, same seam and same default.
   *
   * A test has to supply one. The default builds a blob URL from the verified
   * bytes and imports that, which is what a browser does and what jsdom cannot
   * do, so a test reaching the default gets a quarantined outcome for a reason
   * that has nothing to do with what it is asserting. Before the loader stopped
   * re-fetching by URL these tests reached the default and passed, because
   * vitest's module runner resolved the fixture URL: that was never the
   * browser's behaviour and the pass was measuring the test runner.
   */
  importBundle?: (bytes: ArrayBuffer, url: string) => Promise<unknown>,
): Promise<UplinkLoadOutcome[]> {
  const roster = await readRosterFromTelemetryClient(
    telemetryClient,
    rosterTimeoutMs,
  );
  return loadEnabledUplinks({
    registrySource: localRegistrySource(),
    // Explicit `?uplinkLoaderIds=` override wins over the roster (same
    // precedence rule as the main-screen boot call).
    override: loaderBootIdsOverride(),
    hostCompat,
    appVersion: VERSION,
    roster,
    // The D6 conduit: a station has no route to verify a bundle against an
    // author host directly, so the HOST does that verification and relays
    // the already-checked bytes back. This is the one line that makes this
    // whole function station-safe: no direct `fetch` for bundle bytes ever
    // happens here.
    fetchBytes: createPeerBundleFetcher(bundleFetchConduit),
    importBundle,
  });
}

export interface StationUplinkLoaderProps {
  children: ReactNode;
  /** Test seam: overrides the default 3000ms roster-read timeout. */
  rosterTimeoutMs?: number;
}

/**
 * Gates `children` on the station's `runStationUplinkLoad` run completing,
 * mirrors `main.tsx` running its loader before `renderApp()`, since the
 * component registry doesn't notify on a late `registerComponent()` call.
 *
 * Waits for BOTH `useTelemetryClientOptional()` (the peer `TelemetryClient`,
 * built in `SitrepTelemetryProvider`'s own mount effect: undefined for a
 * render or two after this component itself mounts) and `usePeerClient()`
 * (the `PeerClientService`, provided synchronously by `PeerClientProvider`
 * in practice, but read defensively the same way) before starting the load.
 *
 * Runs the load EXACTLY ONCE per mounted instance: `startedRef` latches
 * before the async work begins, so a React StrictMode dev double-invoke of
 * this effect (mount -> cleanup -> mount, same component instance, same
 * ref) never fires the loader twice: the guard is a ref, not state, so it
 * survives the simulated remount untouched. It does NOT re-run merely
 * because `telemetryClient`/`peerClient` change identity after the first
 * successful start; both are effectively stable for the lifetime of a
 * connected station session (see `StationScreen`), so this is a one-shot by
 * design, not an oversight.
 *
 * On roster read timeout, `roster` is `undefined` and the loader still runs,
 * same degraded-boot rule as the main screen's `LoaderContext.roster`
 * doc comment: so this can never block forever waiting on a mod that isn't
 * talking (dev/offline/no-CPU station-only sessions still get the default
 * client set). A per-widget load failure quarantines that one Uplink
 * (existing loader behaviour); it never prevents the OTHER Uplinks (or the
 * gate itself) from completing.
 */
export function StationUplinkLoader({
  children,
  rosterTimeoutMs,
}: StationUplinkLoaderProps) {
  const telemetryClient = useTelemetryClientOptional();
  const peerClient = usePeerClient();
  const [ready, setReady] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!telemetryClient || !peerClient) return;
    startedRef.current = true;

    void runStationUplinkLoad(telemetryClient, peerClient, rosterTimeoutMs)
      .catch((err) => {
        logger.error(
          "[uplink-loader] station loader path threw",
          err instanceof Error ? err : new Error(String(err)),
        );
      })
      .finally(() => setReady(true));
  }, [telemetryClient, peerClient, rosterTimeoutMs]);

  if (!ready) {
    return (
      <LoadingPlaceholder role="status" aria-live="polite">
        Loading station widgets...
      </LoadingPlaceholder>
    );
  }

  return <>{children}</>;
}

const LoadingPlaceholder = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  padding: var(--space-24);
  color: var(--color-text-muted);
  font-size: var(--font-size-base);
`;
