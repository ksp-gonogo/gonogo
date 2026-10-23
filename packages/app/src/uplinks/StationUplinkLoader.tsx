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
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Button,
  Cluster,
  speakQuantity,
  Text,
  Unit,
  UnitSharedFormat,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import styled, { css, keyframes } from "styled-components";
import { usePeerClient } from "../peer/PeerClientContext";
import type { PeerClientService } from "../peer/PeerClientService";
import { VERSION } from "../version";
import { loaderBootIdsOverride } from "./flag";
import { hostCompat } from "./hostCompat";
import { loadEnabledUplinks, loadHostAdditions, retryUplink } from "./loader";
import {
  getUplinkOutcomes,
  type RunningUplink,
  subscribeUplinkOutcomes,
  type UplinkLoadOutcome,
} from "./loaderState";
import {
  type BundleFetchConduit,
  createPeerBundleFetcher,
  createPeerManifestFetcher,
} from "./peerBundleFetch";
import { localRegistrySource } from "./registry";
import {
  decodeRosterPayload,
  readRosterFromTelemetryClient,
} from "./rosterProbe";

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
    /*
     * The D6 conduit: a station has no route to verify a bundle against an
     * author host directly, so the HOST does that verification and relays the
     * already-checked bytes back. No direct `fetch` for bundle bytes ever
     * happens on a station, and a third-party client's manifest comes the same
     * way.
     */
    fetchBytes: createPeerBundleFetcher(bundleFetchConduit),
    fetchManifest: createPeerManifestFetcher(bundleFetchConduit),
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

/**
 * Load the Uplinks of the main screen's set that were waiting for the game's
 * Uplink list, now that `roster` is that list. Returns the outcomes of the loads
 * it made, empty when nothing was waiting.
 */
export async function loadWithArrivedRoster(
  roster: NonNullable<
    Awaited<ReturnType<typeof readRosterFromTelemetryClient>>
  >,
  bundleFetchConduit: BundleFetchConduit,
  hostUplinks: readonly RunningUplink[],
  importBundle?: (bytes: ArrayBuffer, url: string) => Promise<unknown>,
): Promise<UplinkLoadOutcome[]> {
  const waiting = new Set(
    getUplinkOutcomes()
      .filter((o) => o.awaitingRoster)
      .map((o) => o.id),
  );
  if (!roster.some((entry) => waiting.has(entry.id))) return [];
  return loadHostAdditions(
    loaderContext(roster, bundleFetchConduit, hostUplinks, importBundle),
  );
}

/**
 * Load one Uplink of the main screen's set again, whatever its last outcome,
 * reading the game's Uplink list afresh first. Returns its outcome, or nothing
 * when the set no longer names it.
 */
export async function retryStationUplink(
  telemetryClient: TelemetryClient,
  bundleFetchConduit: BundleFetchConduit,
  hostUplinks: readonly RunningUplink[],
  id: string,
  rosterTimeoutMs?: number,
  importBundle?: (bytes: ArrayBuffer, url: string) => Promise<unknown>,
): Promise<UplinkLoadOutcome[]> {
  const roster = await readRosterFromTelemetryClient(
    telemetryClient,
    rosterTimeoutMs,
  );
  return retryUplink(
    loaderContext(roster, bundleFetchConduit, hostUplinks, importBundle),
    id,
  );
}

/** Whether `outcome` is the main screen's `uplink` loaded at the version the main screen runs. */
function matchesHost(
  uplink: RunningUplink,
  outcome: UplinkLoadOutcome | undefined,
): boolean {
  return outcome?.status === "loaded" && outcome.version === uplink.version;
}

export interface StationUplinkLoaderProps {
  children: ReactNode;
  /** Test seam: overrides the default 3000ms wait for the game's Uplink list. */
  rosterTimeoutMs?: number;
  /** Test seam: what the station does when it must start again from a new set. Reloads the page. */
  reload?: () => void;
  /**
   * Test seam: overrides `LoaderContext.importBundle`. jsdom cannot import the
   * blob URL the default builds, so a test that needs an Uplink to load passes one.
   */
  importBundle?: (bytes: ArrayBuffer, url: string) => Promise<unknown>;
}

/**
 * Gates `children` on every Uplink the main screen runs being loaded on this
 * station at the main screen's version. A station that is missing one cannot
 * show the main screen's dashboard faithfully, so until then it shows one row
 * per Uplink with how far it has got, and a failed Uplink keeps that screen up
 * with its reason and a Retry. A later set from the main screen that adds an
 * Uplink brings the screen back until the addition loads.
 *
 * Waits for the peer `TelemetryClient` and the `PeerClientService`, then for
 * the main screen to say which Uplinks it runs, and loads exactly that set.
 * From then on every set the main screen sends is followed with
 * {@link followHostUplinks}, one at a time.
 *
 * Starts exactly once per mounted instance: `startedRef` latches before the
 * async work begins, so a React StrictMode double-invoke never loads twice.
 */
export function StationUplinkLoader({
  children,
  rosterTimeoutMs,
  reload = () => window.location.reload(),
  importBundle,
}: StationUplinkLoaderProps) {
  const telemetryClient = useTelemetryClientOptional();
  const peerClient = usePeerClient();
  const outcomes = useSyncExternalStore(
    subscribeUplinkOutcomes,
    getUplinkOutcomes,
  );
  const [hostSet, setHostSet] = useState<readonly RunningUplink[] | null>(null);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const startedRef = useRef(false);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const hostSetRef = useRef<readonly RunningUplink[] | null>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  const fail = useCallback((err: unknown) => {
    logger.error(
      "[uplink-loader] station loader path threw",
      err instanceof Error ? err : new Error(String(err)),
    );
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    if (!telemetryClient || !peerClient) return;
    startedRef.current = true;

    const enqueue = (step: () => Promise<unknown>) => {
      chainRef.current = chainRef.current.then(step).catch(fail);
    };
    /*
     * The first load reads the game's Uplink list once, with a deadline. A
     * screen slow to start can miss it, so an Uplink that waited for the list
     * is loaded when the list arrives.
     */
    telemetryClient.subscribe("system.uplinks", (value: unknown) => {
      const roster = decodeRosterPayload(value);
      const set = hostSetRef.current;
      if (!roster || !set) return;
      enqueue(() =>
        loadWithArrivedRoster(roster, peerClient, set, importBundle),
      );
    });
    peerClient.onHostUplinksChange((set) => {
      if (!set) return;
      const first = hostSetRef.current === null;
      hostSetRef.current = set;
      setHostSet(set);
      if (first) {
        enqueue(() =>
          runStationUplinkLoad(
            telemetryClient,
            peerClient,
            set,
            rosterTimeoutMs,
            importBundle,
          ).finally(() => setFirstLoadDone(true)),
        );
        return;
      }
      enqueue(() =>
        followHostUplinks(
          telemetryClient,
          peerClient,
          set,
          () => reloadRef.current(),
          rosterTimeoutMs,
          importBundle,
        ),
      );
    });
  }, [telemetryClient, peerClient, rosterTimeoutMs, importBundle, fail]);

  const retry = useCallback(
    (id: string) => {
      const set = hostSetRef.current;
      if (!telemetryClient || !peerClient || !set) return;
      chainRef.current = chainRef.current
        .then(() =>
          retryStationUplink(
            telemetryClient,
            peerClient,
            set,
            id,
            rosterTimeoutMs,
            importBundle,
          ),
        )
        .catch(fail);
    },
    [telemetryClient, peerClient, rosterTimeoutMs, importBundle, fail],
  );

  const byId = new Map(outcomes.map((o) => [o.id, o]));
  if (hostSet?.every((u) => matchesHost(u, byId.get(u.id)))) {
    return <>{children}</>;
  }

  return (
    <StationUplinkGate>
      <StationUplinkGate__Title>
        Loading station widgets
      </StationUplinkGate__Title>
      <Text level="muted" size="sm">
        This station opens once it has every Uplink the main screen runs.
      </Text>
      <StationUplinkGate__List
        role="status"
        aria-live="polite"
        aria-label="Uplinks"
      >
        {hostSet === null ? (
          <StationUplinkGate__Row>
            <Text level="muted">Waiting for the main screen's Uplink list</Text>
          </StationUplinkGate__Row>
        ) : (
          hostSet.map((uplink) => (
            <UplinkGateRow
              key={uplink.id}
              uplink={uplink}
              outcome={byId.get(uplink.id)}
              firstLoadDone={firstLoadDone}
              onRetry={retry}
            />
          ))
        )}
      </StationUplinkGate__List>
    </StationUplinkGate>
  );
}

/** A row's bar: how much of the client has arrived, or `null` while that cannot be told. */
type RowProgress = { received: number; total: number } | null;

interface RowState {
  word: string;
  tone: "info" | "go" | "caution" | "nogo";
  detail?: string;
  retry?: true;
  progress?: RowProgress;
}

function rowState(
  uplink: RunningUplink,
  outcome: UplinkLoadOutcome | undefined,
  firstLoadDone: boolean,
): RowState {
  if (!outcome) {
    return firstLoadDone
      ? { word: "Queued", tone: "info", progress: null }
      : {
          word: "Waiting for the game's Uplink list",
          tone: "info",
          progress: null,
        };
  }
  if (outcome.awaitingRoster) {
    return {
      word: "Waiting for the game's Uplink list",
      tone: "caution",
      detail: "The game has not listed this Uplink",
      retry: true,
      progress: null,
    };
  }
  if (outcome.status === "loading") {
    if (outcome.phase === "downloading")
      return {
        word: "Downloading",
        tone: "info",
        progress: outcome.progress ?? null,
      };
    if (outcome.phase === "verifying")
      return { word: "Verifying", tone: "info", progress: null };
    return { word: "Preparing", tone: "info", progress: null };
  }
  if (outcome.status === "loaded") {
    return matchesHost(uplink, outcome)
      ? { word: "Loaded", tone: "go", progress: { received: 1, total: 1 } }
      : {
          word: "Wrong version",
          tone: "caution",
          detail: `the main screen runs ${uplink.version}, this station has ${outcome.version ?? "an unknown version"}`,
        };
  }
  return {
    word: "Failed",
    tone: "nogo",
    detail: outcome.summary ?? outcome.reason,
    retry: true,
  };
}

function UplinkGateRow({
  uplink,
  outcome,
  firstLoadDone,
  onRetry,
}: {
  uplink: RunningUplink;
  outcome: UplinkLoadOutcome | undefined;
  firstLoadDone: boolean;
  onRetry: (id: string) => void;
}) {
  const state = rowState(uplink, outcome, firstLoadDone);
  const name = outcome?.name ?? uplink.id;
  return (
    <StationUplinkGate__Row data-uplink-id={uplink.id}>
      <Cluster justify="between" gap="related-dense" wrap>
        <Text weight="semibold">{name}</Text>
        <Badge tone={state.tone}>{state.word}</Badge>
      </Cluster>
      {state.progress !== undefined && (
        <UplinkProgressBar name={name} progress={state.progress} />
      )}
      {state.detail && (
        <Text level="muted" size="sm">
          {state.detail}
        </Text>
      )}
      {state.retry && (
        <StationUplinkGate__Retry>
          <Button
            size="sm"
            aria-label={`Retry ${name}`}
            onClick={() => onRetry(uplink.id)}
          >
            Retry
          </Button>
        </StationUplinkGate__Retry>
      )}
    </StationUplinkGate__Row>
  );
}

function UplinkProgressBar({
  name,
  progress,
}: {
  name: string;
  progress: RowProgress;
}) {
  if (!progress) {
    return (
      <StationUplinkGate__Track
        role="progressbar"
        aria-label={`${name} progress`}
        data-indeterminate=""
      >
        <StationUplinkGate__Fill $indeterminate />
      </StationUplinkGate__Track>
    );
  }
  const { received, total } = progress;
  const percent = total > 0 ? Math.round((received / total) * 100) : 0;
  const complete = received >= total;
  const spoken = complete
    ? undefined
    : `${speakQuantity({ magnitude: received, unit: "B" }, { decimals: 1 })} of ${speakQuantity({ magnitude: total, unit: "B" }, { decimals: 1 })}`;
  return (
    <>
      <StationUplinkGate__Track
        role="progressbar"
        aria-label={`${name} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={spoken ?? "Complete"}
      >
        <StationUplinkGate__Fill
          $complete={complete}
          style={{ width: `${percent}%` }}
        />
      </StationUplinkGate__Track>
      {!complete && (
        <Text level="muted" size="sm">
          <UnitSharedFormat decimals={1}>
            <Unit value={value("B", received)} hideUnitInGroup /> of{" "}
            <Unit value={value("B", total)} />
          </UnitSharedFormat>
        </Text>
      )}
    </>
  );
}

const sweep = keyframes`
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
`;

const StationUplinkGate__Track = styled.div`
  position: relative;
  height: 0.375rem;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
`;

const StationUplinkGate__Fill = styled.div<{
  $indeterminate?: boolean;
  $complete?: boolean;
}>`
  height: 100%;
  background: ${({ $complete }) =>
    $complete ? "var(--color-go-mark)" : "var(--color-info-mark)"};
  transition: width var(--duration-fast) var(--ease-linear);
  ${({ $indeterminate }) =>
    $indeterminate &&
    css`
      width: 40%;
      opacity: 0.6;
      @media (prefers-reduced-motion: no-preference) {
        animation: ${sweep} 1.4s ease-in-out infinite;
      }
    `}
`;

const StationUplinkGate = styled.section`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  width: 100%;
  max-width: 40rem;
  min-height: 60vh;
  margin: 0 auto;
  padding: var(--inset-screen-message);
`;

const StationUplinkGate__Title = styled.h2`
  margin: 0;
  font-size: var(--font-size-lg);
`;

const StationUplinkGate__List = styled.ul`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  margin: 0;
  padding: 0;
  list-style: none;
`;

const StationUplinkGate__Row = styled.li`
  display: flex;
  flex-direction: column;
  gap: var(--gap-caption);
  min-width: 0;
  overflow-wrap: anywhere;
`;

const StationUplinkGate__Retry = styled.div`
  display: flex;
`;
