import { useEffect } from "react";
import { useStream } from "./use-stream";

/**
 * One vessel's CORE contact facts, read off `fleet.<guid>.contact`.
 *
 * Every field arrives as a bare wire value rather than a wrapped `Value<"s">`,
 * for the same reason as {@link FleetVesselLink}: `fleet.<guid>.*` is a dynamic
 * topic and `wrapTopicPayload` keys on the exact topic string, which no per-guid
 * topic matches. The generated `FleetVesselContact` describes the wire contract;
 * this is the shape a client actually receives.
 *
 * Deliberately narrow: whether the vessel is in contact and when it was last
 * heard from, ordinary CommNet fact rather than any model's opinion. The
 * SilenceTracker's reckoning of that silence (state / deadline / prediction)
 * is a SEPARATE comms-owned wire shape, {@link FleetVesselSilence}.
 */
export interface FleetVesselContact {
  /** Whether contact was observed on the most recent capture tick. */
  connected: boolean;
  /** UT of the last sample that observed contact. Null before the first-ever contact. */
  lastContactUt?: number | null;
}

/**
 * One vessel's officially-lost RECKONING, read off `silence.<guid>.state`: a
 * comms-derived model's opinion (the SilenceTracker's), not a fact stock KSP
 * hands you. See {@link FleetVesselContact}'s doc comment for why the two are
 * separate wire shapes and separate dynamic namespaces.
 */
export interface FleetVesselSilence {
  state: "Nominal" | "Silent" | "Lost";
  /** UT the current silence run began. Null while Nominal. */
  silenceSinceUt?: number | null;
  /** UT this silence becomes eligible to be declared Lost. Null while Nominal, or when destroyed. */
  deadlineUt?: number | null;
  deadlineBasis?: SilenceDeadlineBasis | null;
  /**
   * UT the radio path is predicted to re-open. Null is a prediction WITHHELD,
   * never an emergence of "now", see {@link contactPhase}, which is the only
   * place that distinction should have to be made.
   */
  predictedReacquisitionUt?: number | null;
}

export type SilenceDeadlineBasis =
  | "orbital-period"
  | "policy-floor"
  | "policy-ceiling"
  | "no-orbit"
  | "destroyed"
  | "predicted-reacquisition"
  | "no-occultation"
  | "no-emergence-in-window"
  | "warp-limited"
  | "grace-exceeds-ceiling";

/**
 * What an operator is actually being told, which is not the same as the
 * tracker's three states.
 *
 * `overdue` is the one worth having: past the moment geometry said the vessel
 * should have re-appeared, but not yet past the deadline that would declare it
 * lost. It is the "expected back, didn't show" moment, and it only exists when
 * there was a prediction to be late against, a vessel quiet with no predicted
 * emergence is `waiting`, not overdue, because nothing ever promised it would
 * be back.
 */
export type ContactPhase =
  | "nominal"
  | "waiting"
  | "expected"
  | "overdue"
  | "lost";

export function contactPhase(
  silence: FleetVesselSilence | undefined,
  nowUt: number,
): ContactPhase | undefined {
  if (!silence) return undefined;
  if (silence.state === "Lost") return "lost";
  if (silence.state === "Nominal") return "nominal";

  const predicted = silence.predictedReacquisitionUt;
  if (predicted == null) return "waiting";
  return nowUt > predicted ? "overdue" : "expected";
}

/**
 * Seconds a vessel is late by, or undefined when it is not late. Undefined
 * covers both "not yet due" and "never had a prediction to be due against";
 * neither should render a duration.
 */
export function overdueSeconds(
  silence: FleetVesselSilence | undefined,
  nowUt: number,
): number | undefined {
  if (contactPhase(silence, nowUt) !== "overdue") return undefined;
  const predicted = silence?.predictedReacquisitionUt;
  return predicted == null ? undefined : nowUt - predicted;
}

/** The core per-vessel contact facts for fleet vessel `guid`, or undefined until they arrive. */
export function useFleetVesselContact(
  guid: string,
): FleetVesselContact | undefined {
  return useStream<FleetVesselContact>(`fleet.${guid}.contact`);
}

/**
 * Per-vessel silence-reckoning bridge (contribution-slots-spec pattern): a
 * contribution's `deps` are declared once, statically, at module load, while
 * `silence.<guid>.state` only resolves once SOMETHING knows which guid to
 * subscribe. {@link useFleetVesselSilence} is that something: whichever
 * widget renders a vessel keeps its silence topic subscribed by calling the
 * hook, and this mirrors the latest value here so a contribution's `compute`
 * (which only ever sees its declared, static deps) can still read it by
 * vessel id. Same "static pointer bridging a lifetime mismatch" discipline
 * `getViewUt()` already uses for the view clock, just per-vessel instead of
 * singleton.
 */
const latestSilenceByVessel = new Map<string, FleetVesselSilence>();

/** The most recently observed silence reckoning for `vesselId`, or undefined if none has arrived (or the vessel has never been subscribed). */
export function getLatestFleetVesselSilence(
  vesselId: string,
): FleetVesselSilence | undefined {
  return latestSilenceByVessel.get(vesselId);
}

/** The comms-owned silence reckoning for fleet vessel `guid`, or undefined until it arrives. Also mirrors into {@link getLatestFleetVesselSilence}'s bridge for the duration this hook is mounted. */
export function useFleetVesselSilence(
  guid: string,
): FleetVesselSilence | undefined {
  const silence = useStream<FleetVesselSilence>(`silence.${guid}.state`);
  // Mirrored synchronously during RENDER, not inside a useEffect: every
  // component's render phase in a commit finishes before any component's
  // effects run, so a sibling contribution aggregator's effect (which reads
  // this bridge from `compute`) is guaranteed to see this frame's fresh
  // value regardless of where either component sits in the tree. Writing
  // this in an effect instead raced the aggregator's own effect, whichever
  // happened to sit first in the tree could read a stale (often empty)
  // bridge for a full extra frame. The write is idempotent (repeated or
  // speculative renders just set the same value again), the accepted shape
  // for mirroring an external subscription into a plain module-level cache.
  if (guid) {
    if (silence) {
      latestSilenceByVessel.set(guid, silence);
    } else {
      latestSilenceByVessel.delete(guid);
    }
  }
  useEffect(() => {
    return () => {
      if (guid) latestSilenceByVessel.delete(guid);
    };
  }, [guid]);
  return silence;
}
