import { useTelemetry } from "@ksp-gonogo/core";
import { useObservedVantage } from "@ksp-gonogo/sitrep-client";
import type { CommandCentreEntry } from "@ksp-gonogo/sitrep-sdk";
import { useSeat } from "@ksp-gonogo/sitrep-sdk/spine";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePeerClient } from "../peer/PeerClientContext";
import { getStationKey } from "../peer/stationPeerId";
import { useStationNameOptional } from "../stationIdentity";
import { CommcastLog } from "./CommcastLog";
import { useCommcastLogOptional } from "./CommcastLogContext";
import { CommcastMesh } from "./CommcastMesh";
import type { SeparationMatrix, Vantage } from "./reveal";
import type { CommsRecipient } from "./types";

const CommcastContext = createContext<CommcastLog | null>(null);

/**
 * Mounts this screen's own log and attaches it to the mesh.
 *
 * Symmetric on purpose. Under the host-authoritative thread the two ends ran
 * different code: one owned the list, the other mirrored it. Here every
 * participant runs the same log over the same two frames, and the only
 * asymmetry left is that the host's mesh also repeats what it hears, because
 * PeerJS is a star and nobody else can reach the other stations.
 */
export function CommcastProvider({
  log: injected,
  children,
}: {
  /** Overrides the log this screen would build; for tests and probes. */
  log?: CommcastLog | null;
  children: ReactNode;
}) {
  const peer = usePeerClient();
  const fromContext = useCommcastLogOptional();
  const me = useLocalParticipant();
  const [built, setBuilt] = useState<CommcastLog | null>(null);

  const log = injected ?? fromContext ?? built;

  useEffect(() => {
    if (injected !== undefined || fromContext) return;
    /*
     * Keyed on the STATION key, which is this screen's stable identity. Two
     * tabs on one browser are two vantages with two logs, and a single key
     * would silently merge them into one, which is the central store in
     * miniature.
     */
    setBuilt(new CommcastLog({ screenKey: me.stationKey }));
  }, [injected, fromContext, me.stationKey]);

  /*
   * The log has to know where it is standing before it can tell its own mail
   * from everyone else's, and the vantage comes off the first frame, which is
   * later than the log exists.
   */
  useEffect(() => log?.setVantage(me.vantageId), [log, me.vantageId]);

  // A peer screen builds its own one-hop mesh. The host's was built with its
  // log, at screen level, because the relay has to run for the other stations
  // whether or not this screen is showing the tile.
  useEffect(() => {
    if (!log || !peer || fromContext) return;
    const mesh = CommcastMesh.forClient(peer, me.stationKey, {
      onMessage: (msg) => log.receiveTransmission(msg),
      onAck: (ack) => log.receiveAck(ack),
      onRadio: (frame) => log.receiveRadio(frame),
    });
    log.setTransmitter(mesh);
    return () => {
      log.setTransmitter(undefined);
      mesh.dispose();
    };
  }, [log, peer, fromContext, me.stationKey]);

  return (
    <CommcastContext.Provider value={log}>{children}</CommcastContext.Provider>
  );
}

/** This screen's log, or null before it has been built. */
export function useCommcastLog(): CommcastLog | null {
  return useContext(CommcastContext);
}

/**
 * Who the operator at this screen is.
 *
 * `stationKey` rather than a peer id: a peer id is fresh on every page load, so
 * attributing a message to one means the author of something said an hour ago
 * stops being the same person after they refresh. `vantageId` is the OBSERVED
 * vantage, which on a station is its host's, correctly: a station reads the
 * host's relayed frames, so the two are genuinely co-located.
 */
export function useLocalParticipant(): {
  stationKey: string;
  name: string;
  seat: ReturnType<typeof useSeat>;
  vantageId: string | undefined;
} {
  const seat = useSeat();
  const named = useStationNameOptional();
  const vantageId = useObservedVantage();
  const stationKey = useMemo(() => getStationKey(), []);
  // A screen with no identity provider still has a seat, and the seat is a
  // truthful thing to be called. Blank is the one thing it must never be:
  // "from the ground" and "from nobody" must not read the same.
  const name = named ?? (seat === "pilot" ? "Pilot" : "Mission Control");
  return useMemo(
    () => ({ stationKey, name, seat, vantageId }),
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

/**
 * Who this screen can address.
 *
 * `commandCentre.roster` alone, and that is the whole answer rather than half
 * of it: the roster is the union of the ground stations AND the crewed control
 * vessels (`Kind: "CrewedVessel"`, ids `"vessel:<guid>"`), so joining it with
 * `system.vessels` would add only craft with nobody aboard, which have nobody
 * to message. It is also the same vantage vocabulary `SetVantage` selects and
 * the separation ledger is keyed on, so an address needs no translation to
 * become a delay.
 *
 * This screen's own vantage is excluded. Talking to yourself is a real zero
 * rather than a broken model, but it is not a thing to offer in a picker.
 */
export function useRecipients(me: Vantage): readonly CommsRecipient[] {
  const reading = useTelemetry("commandCentre.roster");
  const entries: readonly CommandCentreEntry[] =
    reading.state === "observed"
      ? reading.value
      : reading.state === "stale"
        ? reading.value
        : [];
  return useMemo(
    () =>
      entries
        .filter((e) => e.id !== undefined && e.id !== me.vantageId)
        .map((e) => ({
          id: e.id as string,
          name: e.displayName ?? (e.id as string),
          // A centre that is not a valid command source right now has nobody
          // sitting at it. Still addressable: a message to an empty room goes
          // unacknowledged, which is an honest outcome and not a reason to
          // hide the address.
          staffed: e.active === true,
        })),
    [entries, me.vantageId],
  );
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
