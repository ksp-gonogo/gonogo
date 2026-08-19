import { useTelemetry } from "@ksp-gonogo/core";
import {
  type Reading,
  useReputationLossEvents,
  useStickyVesselGuids,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { magnitudeOf } from "../shared/magnitude";
import {
  detectContractsCompleted,
  detectDocking,
  detectEva,
  detectScienceCollected,
  detectSoiChange,
  detectStaging,
  fromCrash,
  fromFlightEnded,
  fromFlightStarted,
  fromRecovery,
  fromReputationLoss,
  fromVesselChanged,
  type MissionEvent,
} from "./events";

/** KSP VesselType for an EVA kerbal; the SDK may expose it as the number or "EVA". */
/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

function isEvaType(v: unknown): number {
  if (v === 7 || v === "7" || v === "EVA") return 7;
  return typeof v === "number" ? v : 0;
}

interface EdgePrev {
  stage?: number;
  body?: number;
  docked?: boolean;
  vType?: number;
  contracts?: readonly { id?: unknown; title?: unknown }[];
  science?: number;
}

/**
 * Accumulate the mission's events from the live stream into one UT-sorted list.
 *
 * Tier A (discrete topics carrying their own `ut`) are shaped straight; Tier B
 * (value topics) are edge-detected against the previous sample and stamped with
 * the current view UT (`useViewUt`). De-dup is by event `id` so a periodically
 * re-emitted discrete snapshot never doubles a row.
 *
 * v1 limitations (accepted, see events.ts): Tier-B edges can be missed between
 * samples or re-fire if the stream reconnects (prev resets); `crash.lastCrash`/
 * `recovery.lastSummary` are single "last" slots, so a mission RELOAD starts the
 * log empty rather than replaying history. A future discrete mod `*.event` topic
 * removes the Tier-B risks.
 */
export function useMissionEvents(): MissionEvent[] {
  // `.magnitude`: everything below treats the view time as a bare UT for arithmetic,
  // and the instant type earns nothing threaded through it. Unwrapped once, here.
  const ut = useViewUt()?.magnitude ?? 0;

  /**
   * Every read below goes through `stillTrue`, and none through `judgeable`,
   * because a log is a record of what HAPPENED rather than a verdict about now.
   *
   * Two reasons, one per half of the read set. A Tier-A record is an immutable
   * account of a past occurrence carrying its own `ut`, so a held one is not an
   * aged guess at the present, it is the same true sentence it was when it
   * arrived, and withholding it would delete a crash from the log because the
   * link went quiet after the crash. The Tier-B fields are all discrete states
   * the vessel changes by EVENT (a stage count, a reference body, a docking
   * port, a vessel type, a completed-contract list, a science total), so none of
   * them drifts on its own between samples, which is the test `stillTrue` sets.
   *
   * On the Tier-B half `judgeable` would be actively wrong rather than merely
   * cautious. `vessel.orbit` and `career.status` can both reach `reckonable`, so
   * it would feed a MODELLED reference body or a rate-integrated science total
   * into the edge detectors, and an edge between one real sample and one
   * propagated value logs an SOI change or a science gain nobody observed. A
   * model may say where the craft will be; it may not write the mission log.
   */
  // Tier A: discrete topics.
  const flightStarted = stillTrue(useTelemetry("flight.started"), undefined);
  const flightEnded = stillTrue(useTelemetry("flight.ended"), undefined);
  const vesselChanged = stillTrue(
    useTelemetry("flight.vesselChanged"),
    undefined,
  );
  const crash = stillTrue(useTelemetry("crash.lastCrash"), undefined);
  const recovery = stillTrue(useTelemetry("recovery.lastSummary"), undefined);

  // Tier B: value topics we edge-detect.
  const structure = stillTrue(useTelemetry("vessel.structure"), undefined);
  const orbit = stillTrue(useTelemetry("vessel.orbit"), undefined);
  /**
   * The dock read keeps its whole reading, because this is the one topic here
   * whose ABSENCE is the value: a null payload is how "not docking" reaches us,
   * and `vessel.dock` declares `AbsenceIsData`, so a real session tombstones it
   * on the first tick the craft is not docking.
   *
   * That makes `pending` a different sentence from `absent` and worth a branch.
   * "Nothing has arrived yet" is not evidence of an undocked craft, and reading
   * it as one is what logged a Docked row for a vessel that was already docked
   * when the dashboard opened.
   */
  const dockReading = useTelemetry("vessel.dock");
  const dock = stillTrue(dockReading, undefined);
  const dockKnown = dockReading.state !== "pending";
  const identity = stillTrue(useTelemetry("vessel.identity"), undefined);
  const career = stillTrue(useTelemetry("career.status"), undefined);

  // Source-attributed reputation losses: one delayed per-vessel topic each, so the
  // subscription set is the roster PLUS every guid seen earlier. A destroyed vessel
  // leaves the roster while its own event is still crossing its light-time, and a
  // live-roster-only set would have dropped that guid before the news arrived.
  // A roster is a fact and is held while the link is quiet: vessels do not stop
  // existing, and the sticky set below only ever grows anyway.
  const roster = stillTrue(useTelemetry("system.vessels"), undefined);
  const rosterGuids = useMemo(
    () =>
      (roster?.vessels ?? [])
        .map((v) => v.vesselId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    [roster],
  );
  const stickyGuids = useStickyVesselGuids(rosterGuids);
  const reputationLosses = useReputationLossEvents(stickyGuids);

  const byId = useRef<Map<string, MissionEvent>>(new Map());
  const prev = useRef<EdgePrev>({});
  const [events, setEvents] = useState<MissionEvent[]>([]);

  // Add events by id; only re-render when the set actually grows/changes.
  function add(...next: (MissionEvent | null)[]): boolean {
    let changed = false;
    for (const e of next) {
      if (!e || byId.current.has(e.id)) continue;
      byId.current.set(e.id, e);
      changed = true;
    }
    return changed;
  }

  // Tier A: re-shape whenever any discrete snapshot changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on the topic payloads, not `add`.
  useEffect(() => {
    const changed = add(
      fromFlightStarted(flightStarted),
      fromFlightEnded(flightEnded),
      fromVesselChanged(vesselChanged),
      fromCrash(crash),
      fromRecovery(recovery),
    );
    if (changed) flush();
  }, [flightStarted, flightEnded, vesselChanged, crash, recovery]);

  // Source-attributed reputation losses. Separate from the Tier-A effect above because
  // this is a LIST that grows as each vessel's event is revealed, not a set of single
  // "last" slots, and each row is stamped with how old the news is at the moment it
  // arrives (the whole point of the delayed reveal).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the revealed losses; `add` is stable and `ut` must not re-stamp an already-added row.
  useEffect(() => {
    const changed = add(
      ...reputationLosses.map((loss) => fromReputationLoss(loss, ut)),
    );
    if (changed) flush();
  }, [reputationLosses]);

  // Tier B: edge-detect against the previous sample, then update prev.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the value topics; `add`/`prev` are stable refs.
  useEffect(() => {
    const p = prev.current;
    const stage =
      typeof structure?.currentStage === "number"
        ? structure.currentStage
        : undefined;
    const body =
      typeof orbit?.referenceBodyIndex === "number"
        ? orbit.referenceBodyIndex
        : undefined;
    // `undefined` until the channel has said something either way, so the first
    // real sample is compared against a state we actually know rather than
    // against an assumed undocked one. `detectDocking` declines on an unknown
    // side, which is how staging, SOI and science already read "no sample yet".
    const docked = dockKnown ? dock != null : undefined;
    const vType = isEvaType(identity?.vesselType);
    const contracts = career?.contracts?.completedRecent;
    // The magnitude: this is an edge DETECTOR, comparing one frame's science
    // against the last and reporting the difference in a label. Science
    // renders as a glyph rather than a suffix, so there is no symbol to
    // carry into a string, and the comparison wants a plain number.
    const science = magnitudeOf(career?.economy?.science) ?? undefined;

    let changed = add(
      detectStaging(p.stage, stage, ut),
      detectSoiChange(p.body, body, ut),
      detectDocking(p.docked, docked, ut),
      detectEva(p.vType, vType, ut),
      detectScienceCollected(p.science, science, ut),
    );
    if (add(...detectContractsCompleted(p.contracts, contracts, ut))) {
      changed = true;
    }

    prev.current = { stage, body, docked, vType, contracts, science };
    if (changed) flush();
  }, [structure, orbit, dock, dockKnown, identity, career, ut]);

  function flush(): void {
    setEvents(
      [...byId.current.values()].sort((a, b) =>
        a.ut === b.ut ? a.id.localeCompare(b.id) : a.ut - b.ut,
      ),
    );
  }

  return events;
}
