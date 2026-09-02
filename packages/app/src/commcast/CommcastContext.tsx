import { useTelemetry } from "@ksp-gonogo/core";
import { useObservedVantage } from "@ksp-gonogo/sitrep-client";
import { useSeat } from "@ksp-gonogo/sitrep-sdk/spine";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePeerClient } from "../peer/PeerClientContext";
import { getStationKey } from "../peer/stationPeerId";
import { useStationNameOptional } from "../stationIdentity";
import { CommcastClientService } from "./CommcastClientService";
import { useCommcastHostOptional } from "./CommcastHostContext";
import type { CommcastHostService } from "./CommcastHostService";
import type { SeparationMatrix, Vantage } from "./reveal";
import type {
  CommcastSnapshot,
  CommsParticipant,
  CommsSendInput,
} from "./types";
import { EMPTY_COMMCAST_SNAPSHOT } from "./types";

/**
 * The one surface the widget talks to, whichever end of the mesh it is on.
 *
 * The host holds the canonical thread and a peer mirrors it, and the widget
 * must not care which: a command centre, a station and a pilot are all just
 * participants, and the only asymmetry is who happens to own the list.
 */
export interface CommcastThread {
  snapshot(): CommcastSnapshot;
  subscribe(cb: (snap: CommcastSnapshot) => void): () => void;
  send(input: CommsSendInput): void;
  markRead(messageIds: readonly string[], atUt: number): void;
  /** Who this screen posts as. */
  me: CommsParticipant;
  /** Whether a send can currently reach the canonical thread. */
  connected: boolean;
}

const CommcastContext = createContext<CommcastThread | null>(null);

/**
 * Mounts the thread for whichever end this screen is.
 *
 * The choice is "am I the host", not "which screen": a pilot page holds its own
 * telemetry session and is still a peer on the coordination mesh, so it takes
 * the peer-backed thread exactly as a station does. `usePeerClient()` is
 * already the shipped answer to that question and returns null on the host.
 */
export function CommcastProvider({
  hostService,
  children,
}: {
  /** Overrides the host service from context; for tests and probes. */
  hostService?: CommcastHostService | null;
  children: ReactNode;
}) {
  const peer = usePeerClient();
  const fromContext = useCommcastHostOptional();
  const host = hostService ?? fromContext;
  const me = useLocalParticipant();

  const [clientService, setClientService] =
    useState<CommcastClientService | null>(null);
  useEffect(() => {
    if (!peer) {
      setClientService(null);
      return;
    }
    const svc = new CommcastClientService(peer);
    setClientService(svc);
    return () => {
      svc.dispose();
      setClientService(null);
    };
  }, [peer]);

  const thread = useMemo<CommcastThread | null>(() => {
    if (peer) {
      if (!clientService) return null;
      return {
        snapshot: () => clientService.snapshot(),
        subscribe: (cb) => clientService.subscribe(cb),
        send: (input) => clientService.send(me, input),
        markRead: (ids, atUt) => clientService.markRead(me, ids, atUt),
        me,
        connected: true,
      };
    }
    if (!host) return null;
    return {
      snapshot: () => host.snapshot(),
      subscribe: (cb) => host.subscribe(cb),
      send: (input) => {
        host.post(me, input);
      },
      markRead: (ids, atUt) => host.markRead(me, ids, atUt),
      me,
      connected: true,
    };
  }, [peer, clientService, host, me]);

  return (
    <CommcastContext.Provider value={thread}>
      {children}
    </CommcastContext.Provider>
  );
}

/** The thread, or null when this screen has no route to one. */
export function useCommcastThread(): CommcastThread | null {
  return useContext(CommcastContext);
}

/**
 * Who the operator at this screen is, for the thread's purposes.
 *
 * `stationKey` rather than a peer id: a peer id is fresh on every page load, so
 * attributing a message to one means the author of something said an hour ago
 * stops being the same person after they refresh. `vantageId` is the OBSERVED
 * vantage, which on a station is its host's, correctly: a station reads the
 * host's relayed frames, so the two are genuinely co-located.
 */
export function useLocalParticipant(): CommsParticipant {
  const seat = useSeat();
  const named = useStationNameOptional();
  const vantageId = useObservedVantage();
  const stationKey = useMemo(() => getStationKey(), []);
  // A screen with no identity provider still has a seat, and the seat is a
  // truthful thing to be called. Blank is the one thing it must never be:
  // "from the ground" and "from nobody" must not read the same.
  const name = named ?? (seat === "pilot" ? "Pilot" : "Mission Control");
  return useMemo(
    () => ({
      stationKey,
      name,
      seat,
      ...(vantageId === undefined ? {} : { vantageId }),
    }),
    [stationKey, name, seat, vantageId],
  );
}

/**
 * The published vantage-to-vantage separations, as a lookup.
 *
 * `commandCentre.separation` carries the rows the mod already computes for its
 * own delay ledger, so this is the SERVER's number rather than a client
 * derivation: the geometry is solved once, in the place that knows it. Sparse by
 * contract, because an unroutable pair has no separation to quote and a zero
 * would make an unreachable correspondent look merely distant.
 *
 * `undefined` until the first frame lands, which is what keeps a fresh page load
 * out of the `unmeasured` arm for a pair it simply has not heard about yet.
 */
export function useSeparationMatrix(): SeparationMatrix | undefined {
  const reading = useTelemetry("commandCentre.separation");
  const pairs =
    reading.state === "observed"
      ? reading.value.pairs
      : reading.state === "stale"
        ? reading.value.pairs
        : undefined;
  return useMemo(() => {
    if (!pairs) return undefined;
    const byFrom = new Map<string, Map<string, number>>();
    for (const pair of pairs) {
      const seconds = pair.oneWaySeconds?.magnitude;
      if (seconds === undefined || !Number.isFinite(seconds)) continue;
      let row = byFrom.get(pair.from);
      if (!row) {
        row = new Map();
        byFrom.set(pair.from, row);
      }
      row.set(pair.to, seconds);
    }
    return byFrom;
  }, [pairs]);
}

/** The local reader's vantage, the shape every reveal decision is made against. */
export function useMyVantage(): Vantage {
  const seat = useSeat();
  const vantageId = useObservedVantage();
  return useMemo(
    () => ({ seat, ...(vantageId === undefined ? {} : { vantageId }) }),
    [seat, vantageId],
  );
}

export { EMPTY_COMMCAST_SNAPSHOT };
