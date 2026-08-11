import { useStream } from "@ksp-gonogo/sitrep-client";
import type { PartActionEntry, PartActions } from "@ksp-gonogo/sitrep-sdk";

/**
 * The dynamic per-part PAW namespace the mod publishes: this MUST match
 * `PartActionsViewProvider.TopicPrefix` (mod/Sitrep.Host/PartActionsViewProvider.cs).
 * `usePartActions.test.ts` asserts the composed topic string so a rename on
 * either side is a red test rather than a silently dead subscription.
 */
export const PART_ACTIONS_TOPIC_PREFIX = "vessel.partActions.";

/** The concrete wire topic carrying one part's action list. */
export function partActionsTopic(flightId: number | string): string {
  return `${PART_ACTIONS_TOPIC_PREFIX}${flightId}`;
}

export interface PartActionsRead {
  /** The part's PAW buttons, or `undefined` until the first frame lands. */
  actions: readonly PartActionEntry[] | undefined;
  /**
   * True while the subscription has not yet been answered. Under signal delay
   * this is a real wait (one one-way light time), which is why it is a distinct
   * state rather than being collapsed into "no actions": an empty list and an
   * unanswered subscription mean different things to an operator.
   */
  pending: boolean;
}

/**
 * Subscribes ONE part's PAW action list.
 *
 * <p><b>Why one at a time, and why the caller must mount conditionally.</b> The
 * subscription is what makes the mod enumerate anything: it only walks a part's
 * `BaseEvent`s while that part's topic has a subscriber (see
 * `Gonogo.KSP.VesselUplink.RegisterPartActions`). So this hook takes a REQUIRED
 * flightId and the components that call it (`PartActionCount`,
 * `PartActionMenu`) are mounted only while a part is actually hovered or open,
 * rather than the hook taking a nullable id and subscribing to a placeholder
 * topic, which would put a junk subscription on the wire. A ShipMap with nothing
 * hovered therefore costs nothing at either end, and subscribing every rendered
 * part (the thing the per-part namespace exists to avoid) never happens.</p>
 *
 * <p>The list is a live stream, not a one-shot fetch, so it is also the
 * read-back for the invoke command: firing "Extend Solar Panel" flips this list
 * to "Retract Solar Panel" one light-time later. That is why nothing here (or in
 * the menu) optimistically mutates state.</p>
 */
export function usePartActions(flightId: number): PartActionsRead {
  // `useStream` takes a raw topic string and degrades to `undefined` with no
  // provider mounted. A dynamic sub-topic has no member in the `TopicId` union
  // (see the SDK's `TOPIC_IDS` doc), so the canonical typed `useTelemetry`
  // cannot name it; the prefix is carried via `DYNAMIC_CARRIED_TOPIC_PREFIXES`
  // so the store resolves it to its own identity rather than mis-splitting it
  // into a `<domain.channel>.<fieldPath>` nothing publishes.
  const payload = useStream<PartActions>(partActionsTopic(flightId));

  return {
    actions: payload?.actions,
    pending: payload === undefined,
  };
}
