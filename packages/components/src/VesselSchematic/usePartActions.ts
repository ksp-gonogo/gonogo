import { useStream } from "@ksp-gonogo/sitrep-client";
import type { PartActionEntry, PartActions } from "@ksp-gonogo/sitrep-sdk";

/** The dynamic per-part PAW namespace. Must match `PartActionsViewProvider.PartActionsPrefix`, which `partActions.cs-sync.test.ts` reads out of the C# source. */
export const PART_ACTIONS_TOPIC_PREFIX = "vessel.partActions.";

/** The concrete wire topic carrying one part's action list. */
export function partActionsTopic(flightId: number | string): string {
  return `${PART_ACTIONS_TOPIC_PREFIX}${flightId}`;
}

const NO_WINDOWS: readonly PartActionEntry[] = [];
const NO_ROWS: readonly PartWindowRow[] = [];

/** One non-button row of a part's window: a label, switch, slider, option list, cycle or resource. */
export type PartWindowRow = PartActions["window"][number];

export interface PartActionsRead {
  /** The part's PAW buttons, or `undefined` until the first frame lands. */
  actions: readonly PartActionEntry[] | undefined;
  /** Buttons only someone at the game's own screen can finish, drawn disabled. */
  gameWindows: readonly PartActionEntry[];
  /** The part's window rows that are not buttons, in the order the game draws them. */
  rows: readonly PartWindowRow[];
  /** True while the subscription is unanswered: a real wait under signal delay, and not the same as no actions. */
  pending: boolean;
}

/**
 * Subscribes one part's PAW action list and window rows. The mod reads a
 * part's window only while its topic has a subscriber, so the id is required.
 * The Vessel Schematic mounts one for every part while it is on screen, so a
 * part opened later finds a reading already held. The list is live, so it is also the read-back for an invoke
 * ("Extend" becomes "Retract" a signal delay later), and nothing mutates
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
    gameWindows: payload?.gameWindows ?? NO_WINDOWS,
    rows: payload?.window ?? NO_ROWS,
    pending: reading.state === "pending" || reading.state === "unowned",
  };
}
