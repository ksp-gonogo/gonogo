import { useStream } from "./use-stream";

/**
 * One vessel's contact state, read off `fleet.<guid>.contact`.
 *
 * Every field arrives as a bare wire value rather than a wrapped `Value<"s">`,
 * for the same reason as {@link FleetVesselLink}: `fleet.<guid>.*` is a dynamic
 * topic and `wrapTopicPayload` keys on the exact topic string, which no per-guid
 * topic matches. The generated `FleetVesselContact` describes the wire contract;
 * this is the shape a client actually receives.
 */
export interface FleetVesselContact {
  /** Whether contact was observed on the most recent capture tick. */
  connected: boolean;
  state: "Nominal" | "Silent" | "Lost";
  /** UT of the last sample that observed contact. Null before the first-ever contact. */
  lastContactUt?: number | null;
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
  | "warp-limited";

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
  contact: FleetVesselContact | undefined,
  nowUt: number,
): ContactPhase | undefined {
  if (!contact) return undefined;
  if (contact.state === "Lost") return "lost";
  if (contact.state === "Nominal") return "nominal";

  const predicted = contact.predictedReacquisitionUt;
  if (predicted == null) return "waiting";
  return nowUt > predicted ? "overdue" : "expected";
}

/**
 * Seconds a vessel is late by, or undefined when it is not late. Undefined
 * covers both "not yet due" and "never had a prediction to be due against";
 * neither should render a duration.
 */
export function overdueSeconds(
  contact: FleetVesselContact | undefined,
  nowUt: number,
): number | undefined {
  if (contactPhase(contact, nowUt) !== "overdue") return undefined;
  const predicted = contact?.predictedReacquisitionUt;
  return predicted == null ? undefined : nowUt - predicted;
}

/** The per-vessel contact state for fleet vessel `guid`, or undefined until it arrives. */
export function useFleetVesselContact(
  guid: string,
): FleetVesselContact | undefined {
  return useStream<FleetVesselContact>(`fleet.${guid}.contact`);
}
