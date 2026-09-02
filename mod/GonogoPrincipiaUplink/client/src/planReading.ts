import type { Reading, StaleGrade } from "@ksp-gonogo/sitrep-sdk";
import type { PrincipiaPlan } from "./__generated__/contract";

/**
 * What a `principia.plan` reading means to a surface that WRITES to the plan.
 *
 * <p>Shared rather than decided per widget. Two write surfaces read the same
 * channel and both have to answer the same two questions, which reading arms
 * mean there is a plan at all and which of them may be written back against, and
 * two implementations of that would be free to disagree about the one thing the
 * operator is relying on them for. The read-only sections take a different view
 * of the same channel deliberately: `FlightPlanSection` shows a stale plan
 * loudly dated because reading one is safe, and that is not this type.</p>
 */
export type PlanWriteView =
  | { kind: "none"; reason: string }
  | {
      kind: "plan";
      plan: PrincipiaPlan;
      /**
       * Why this plan cannot be written to, or null when it can. A sentence
       * rather than a flag, because the operator's next move is different for
       * each of the three ways contact is lost.
       */
      outOfContact: string | null;
    };

/**
 * A plan the console has never been told about and a vessel with no plan are
 * different facts, and so is a plan we last heard about hours ago.
 *
 * A stale plan is still handed back, because an operator who can see how old it
 * is can act on it. What is refused is WRITING against one: a burn index, a burn
 * count and a plan slot all come off a reading, and a write bounded against a
 * reading from an hour ago is the exact mistake the producer's own protocol is
 * built to prevent.
 *
 * `reading.value` on the stale arms and never `reckoned`: a modelled plan is a
 * guess at a burn LIST, and an index written back has to be one the producer
 * actually reported holding a burn.
 */
export function planView(reading: Reading<PrincipiaPlan>): PlanWriteView {
  switch (reading.state) {
    case "pending":
      return { kind: "none", reason: "Waiting for Principia." };
    case "unowned":
      return {
        kind: "none",
        reason:
          "Nothing publishes this plan. The Principia Uplink declared no plan channel, so waiting will not help: check KSP's log for an Uplink load error.",
      };
    case "absent":
      return {
        kind: "none",
        reason:
          "No plan reading. Principia is not running, or the console has no vessel.",
      };
    case "observed":
      return { kind: "plan", plan: reading.value, outOfContact: null };
    case "stale":
    case "reckonable":
      return {
        kind: "plan",
        plan: reading.value,
        outOfContact: outOfContactReason(reading.grade),
      };
  }
}

/**
 * What a stale reading has lost contact WITH, as something to go and check.
 *
 * The three grades ask for three different next moves: one channel's keyframes
 * drying up is a producer that stopped publishing, a down transport is the whole
 * link, and a last-before-blackout sample is the craft itself behind something.
 * An operator told only that the plan is old checks the wrong one.
 */
export function outOfContactReason(grade: StaleGrade): string {
  switch (grade) {
    case "held-stale":
      return "This plan's updates stopped arriving. The burns below are the last set that did, and the burn count they are numbered against may have moved since.";
    case "disconnected":
      return "The stream is down. The burns below are the last set that reached us, and the burn count they are numbered against may have moved since.";
    case "last-before-blackout":
      return "This craft is out of contact. The burns below are the last set that got out before the blackout, and the burn count they are numbered against may have moved since.";
  }
}
