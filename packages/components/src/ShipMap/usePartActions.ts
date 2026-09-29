import { useStream } from "@ksp-gonogo/sitrep-client";
import type { PartActionEntry, PartActions } from "@ksp-gonogo/sitrep-sdk";

/** The dynamic per-part PAW namespace. Must match `PartActionsViewProvider.PartActionsPrefix`, which `partActions.cs-sync.test.ts` reads out of the C# source. */
export const PART_ACTIONS_TOPIC_PREFIX = "vessel.partActions.";

/** The concrete wire topic carrying one part's action list. */
export function partActionsTopic(flightId: number | string): string {
  return `${PART_ACTIONS_TOPIC_PREFIX}${flightId}`;
}

export interface PartActionsRead {
  /** The part's PAW buttons, or `undefined` until the first frame lands. */
  actions: readonly PartActionEntry[] | undefined;
  /** True while the subscription is unanswered: a real wait under signal delay, and not the same as no actions. */
  pending: boolean;
}

/**
 * Subscribes one part's PAW action list. The mod enumerates a part's
 * `BaseEvent`s only while its topic has a subscriber, so the id is required
 * and callers mount only while a part is hovered or open: an idle ShipMap
 * costs nothing. The list is live, so it is also the read-back for an invoke
 * ("Extend" becomes "Retract" a light-time later), and nothing mutates
 * optimistically.
 */
export function usePartActions(flightId: number): PartActionsRead {
  // A dynamic sub-topic has no `TopicId` member, so `useStream`; its prefix is carried so the store does not split it into a field path.
  const reading = useStream<PartActions>(partActionsTopic(flightId));
  // What a part offers changes only when an action fires, so the list holds.
  const payload =
    reading.state === "observed" || reading.state === "held"
      ? reading.value
      : undefined;

  return {
    actions: payload?.actions,
    pending: reading.state === "pending" || reading.state === "unowned",
  };
}
