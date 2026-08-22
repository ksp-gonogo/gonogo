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
  /**
   * The error budget the deadline was armed with, seconds: how long past the
   * predicted return the craft may stay quiet before its silence is something
   * other than a late reappearance.
   *
   * ONE-SIDED, and not a symmetric uncertainty: an allowance AFTER the
   * predicted moment, so render "allowing 5 min of slack" and never
   * "+/- 5 min". Null wherever the prediction is, since a budget beside a
   * withheld prediction is an error bar around nothing.
   */
  predictionGraceSeconds?: number | null;
}

/**
 * One entry of the fleet-wide `fleet.silence` roster, as it arrives. Unlike
 * the per-vessel `silence.<guid>.state`, this topic IS unit-wrapped on decode
 * (`wrapTopicPayload` matches its exact, static topic string), so every UT
 * arrives as a `Value<"ut">` rather than a bare number, hence the separate
 * shape and {@link silenceByVessel}'s unwrapping.
 */
interface FleetSilenceWireEntry {
  vesselId: string;
  state: string;
  silenceSinceUt?: { magnitude: number } | number | null;
  deadlineUt?: { magnitude: number } | number | null;
  deadlineBasis?: string | null;
  predictedReacquisitionUt?: { magnitude: number } | number | null;
  predictionGraceSeconds?: { magnitude: number } | number | null;
}

/** The `fleet.silence` payload: every tracked vessel's reckoning in one message. */
export interface FleetSilenceRoster {
  vessels?: readonly FleetSilenceWireEntry[] | null;
}

function magnitude(
  v: { magnitude: number } | number | null | undefined,
): number | null {
  const n = typeof v === "object" && v !== null ? v.magnitude : v;
  return n == null || !Number.isFinite(n) ? null : n;
}

/**
 * The fleet-wide roster reshaped into the per-vessel form every consumer
 * already speaks, keyed by vessel id.
 *
 * This is what makes the reckoning readable by something that does NOT already
 * know which vessel to ask about: a contribution declares its dependencies
 * statically at module load, so it can never name a per-guid topic, and the
 * per-vessel bridge only holds vessels something is already subscribed to. One
 * static topic, fanned out here, is what breaks that circle.
 *
 * An entry with no id is dropped rather than keyed under an empty string: a
 * reckoning that cannot say which craft it is about is not about any craft.
 */
export function silenceByVessel(
  roster: FleetSilenceRoster | undefined,
): ReadonlyMap<string, FleetVesselSilence> {
  const byVessel = new Map<string, FleetVesselSilence>();
  for (const entry of roster?.vessels ?? []) {
    if (!entry?.vesselId) continue;
    byVessel.set(entry.vesselId, {
      state: entry.state as FleetVesselSilence["state"],
      silenceSinceUt: magnitude(entry.silenceSinceUt),
      deadlineUt: magnitude(entry.deadlineUt),
      deadlineBasis: (entry.deadlineBasis ??
        null) as SilenceDeadlineBasis | null,
      predictedReacquisitionUt: magnitude(entry.predictedReacquisitionUt),
      predictionGraceSeconds: magnitude(entry.predictionGraceSeconds),
    });
  }
  return byVessel;
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

/**
 * `silence.<guid>.state` carries `Sitrep.Host.Comms.SilenceState` as its NAME,
 * so there is no ordinal to branch on and the branch has to be exhaustive
 * instead. Every declared state is named here, and the `never` binding in the
 * last arm makes a member added to {@link FleetVesselSilence} a compile error
 * until somebody rules on it. `silence-state-exhaustive.test.ts` is the other
 * half: it fails when that union stops covering the C# enum.
 *
 * This used to test for `Lost` and `Nominal` and let everything else fall into
 * the Silent treatment, which made Silent the DEFAULT rather than a case. A
 * member appended to the C# enum, however grave, would have been reported as a
 * vessel waiting quietly to come back, and FleetRoster renders that as no badge
 * at all.
 *
 * A state that reaches the last arm at runtime yields NO phase. That is not the
 * same as {@link FleetVesselSilence} never arriving, which yields no phase for
 * the honest reason that nothing was reckoned; here something was reckoned and
 * we cannot read it. Both render nothing, and nothing is the only answer that
 * is not a claim: `nominal` would assert contact and `waiting` would assert
 * routine silence, and a state we do not recognize supports neither.
 */
export function contactPhase(
  silence: FleetVesselSilence | undefined,
  nowUt: number,
): ContactPhase | undefined {
  if (!silence) return undefined;
  switch (silence.state) {
    case "Nominal":
      return "nominal";
    case "Lost":
      return "lost";
    case "Silent": {
      const predicted = silence.predictedReacquisitionUt;
      if (predicted == null) return "waiting";
      return nowUt > predicted ? "overdue" : "expected";
    }
    default: {
      // Compile-time: `never` once every declared state is cased above, so
      // widening the union without widening this switch stops the build.
      const unruled: never = silence.state;
      void unruled;
      return undefined;
    }
  }
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
