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
import type { PeerClientService } from "../peer/PeerClientService";
import { VERSION } from "../version";
import { loaderBootIdsOverride } from "./flag";
import { hostCompat } from "./hostCompat";
import { loadEnabledUplinks, loadHostAdditions } from "./loader";
import {
  getUplinkOutcomes,
  type RunningUplink,
  type UplinkLoadOutcome,
} from "./loaderState";
import {
  type BundleFetchConduit,
  createPeerBundleFetcher,
} from "./peerBundleFetch";
import { localRegistrySource } from "./registry";
import { readRosterFromTelemetryClient } from "./rosterProbe";

/** The slice of the station's peer link the loader reads: the bundle conduit and the main screen's Uplink set. */
export type StationUplinkConduit = BundleFetchConduit &
  Pick<PeerClientService, "onHostUplinksChange">;

function loaderContext(
  roster: Awaited<ReturnType<typeof readRosterFromTelemetryClient>>,
  bundleFetchConduit: BundleFetchConduit,
  hostUplinks: readonly RunningUplink[],
  importBundle?: (bytes: ArrayBuffer, url: string) => Promise<unknown>,
) {
  return {
    registrySource: localRegistrySource(),
    // Explicit `?uplinkLoaderIds=` override wins over the roster (same precedence rule as the main-screen boot call).
    override: loaderBootIdsOverride(),
    hostCompat,
    appVersion: VERSION,
    roster,
    // The D6 conduit: a station has no route to verify a bundle against an
    // author host directly, so the HOST does that verification and relays
    // the already-checked bytes back. No direct `fetch` for bundle bytes ever
    // happens on a station.
    fetchBytes: createPeerBundleFetcher(bundleFetchConduit),
    bundlesFromHost: true as const,
    hostUplinks,
    importBundle,
  };
}

/**
 * Run the station's equivalent of `main.tsx`'s boot-time loader sequence,
 * sourced entirely through the peer conduit instead of direct network calls:
 * read `system.uplinks` off the ALREADY-CONNECTED peer `TelemetryClient`
 * (never a new transport: see `readRosterFromTelemetryClient`'s own doc
 * comment), then load exactly `hostUplinks`, the set the main screen runs,
 * with `fetchBytes` routed through `createPeerBundleFetcher` (the host
 * verifies + relays bundle bytes, `PeerHostService.handleUplinkBundleRequest`).
 *
 * Pure orchestration, no React, so the wiring is unit-testable with fakes.
 */
export async function runStationUplinkLoad(
  telemetryClient: TelemetryClient,
  bundleFetchConduit: BundleFetchConduit,
  hostUplinks: readonly RunningUplink[],
  rosterTimeoutMs?: number,
  /**
   * Overrides `LoaderContext.importBundle`, same seam and same default.
   *
   * A test has to supply one. The default builds a blob URL from the verified
   * bytes and imports that, which is what a browser does and what jsdom cannot
   * do, so a test reaching the default gets a quarantined outcome for a reason
   * that has nothing to do with what it is asserting.
   */
  importBundle?: (bytes: ArrayBuffer, url: string) => Promise<unknown>,
): Promise<UplinkLoadOutcome[]> {
  const roster = await readRosterFromTelemetryClient(
    telemetryClient,
    rosterTimeoutMs,
  );
  return loadEnabledUplinks(
    loaderContext(roster, bundleFetchConduit, hostUplinks, importBundle),
  );
}

/**
 * Bring a running station in line with a new set from its main screen. An
 * Uplink this station loaded that the main screen no longer runs, or runs at
 * another version, cannot be unloaded, so the station reloads and starts again
 * from the new set; otherwise it loads what the set adds.
 */
export async function followHostUplinks(
  telemetryClient: TelemetryClient,
  bundleFetchConduit: BundleFetchConduit,
  hostUplinks: readonly RunningUplink[],
  reload: () => void,
  rosterTimeoutMs?: number,
  importBundle?: (bytes: ArrayBuffer, url: string) => Promise<unknown>,
): Promise<UplinkLoadOutcome[]> {
  const wanted = new Set(hostUplinks.map((u) => `${u.id}@${u.version}`));
  const stale = getUplinkOutcomes().some(
    (o) => o.status === "loaded" && !wanted.has(`${o.id}@${o.version}`),
  );
  if (stale) {
    reload();
    return [];
  }
  const roster = await readRosterFromTelemetryClient(
    telemetryClient,
    rosterTimeoutMs,
  );
  return loadHostAdditions(
    loaderContext(roster, bundleFetchConduit, hostUplinks, importBundle),
  );
}

/** The main screen's first settled Uplink set, or `null` if it has not said within `timeoutMs`. */
function firstHostUplinks(
  conduit: StationUplinkConduit,
  timeoutMs: number,
): Promise<RunningUplink[] | null> {
  return new Promise((resolve) => {
    let done = false;
    let off: (() => void) | undefined;
    const finish = (set: RunningUplink[] | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off?.();
      resolve(set);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    off = conduit.onHostUplinksChange((set) => {
      if (set) finish(set);
    });
    if (done) off();
  });
}

export interface StationUplinkLoaderProps {
  children: ReactNode;
  /** Test seam: overrides the default 3000ms wait for the roster and for the main screen's Uplink set. */
  rosterTimeoutMs?: number;
  /** Test seam: what the station does when it must start again from a new set. Reloads the page. */
  reload?: () => void;
}

/**
 * Gates `children` on the station's first load completing, mirroring
 * `main.tsx` running its loader before `renderApp()`.
 *
 * Waits for the peer `TelemetryClient` and the `PeerClientService`, then for
 * the main screen to say which Uplinks it runs, and loads exactly that set.
 * If the main screen has not said within the timeout, the children render
 * with nothing loaded. From then on every set the main screen sends is
 * followed with {@link followHostUplinks}, one at a time.
 *
 * Starts exactly once per mounted instance: `startedRef` latches before the
 * async work begins, so a React StrictMode double-invoke never loads twice.
 */
export function StationUplinkLoader({
  children,
  rosterTimeoutMs,
  reload = () => window.location.reload(),
}: StationUplinkLoaderProps) {
  const telemetryClient = useTelemetryClientOptional();
  const peerClient = usePeerClient();
  const [ready, setReady] = useState(false);
  const startedRef = useRef(false);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (startedRef.current) return;
    if (!telemetryClient || !peerClient) return;
    startedRef.current = true;

    const fail = (err: unknown) => {
      logger.error(
        "[uplink-loader] station loader path threw",
        err instanceof Error ? err : new Error(String(err)),
      );
    };
    let chain: Promise<unknown> = Promise.resolve();
    void (async () => {
      const first = await firstHostUplinks(peerClient, rosterTimeoutMs ?? 3000);
      if (first) {
        await runStationUplinkLoad(
          telemetryClient,
          peerClient,
          first,
          rosterTimeoutMs,
        ).catch(fail);
      }
      setReady(true);
      peerClient.onHostUplinksChange((set) => {
        if (!set) return;
        chain = chain
          .then(() =>
            followHostUplinks(
              telemetryClient,
              peerClient,
              set,
              () => reloadRef.current(),
              rosterTimeoutMs,
            ),
          )
          .catch(fail);
      });
    })();
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
  padding: var(--inset-screen-message);
  color: var(--color-text-muted);
  font-size: var(--font-size-compact);
`;
