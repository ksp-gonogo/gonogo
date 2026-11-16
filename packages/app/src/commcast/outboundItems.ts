import type { Value } from "@ksp-gonogo/sitrep-sdk";
import type { InFlightListItem } from "@ksp-gonogo/ui-kit";
import { messageText } from "./groups";
import {
  deliveryPhaseFor,
  isQuickCrossing,
  legOf,
  roundTripFor,
  type SentPhase,
} from "./reveal";
import type { Delivery, OutboundMessage, RecipientId } from "./types";

/**
 * This screen's own words, still out, in the shape the console's queue draws:
 * one row per recipient still on its own round trip. `outbound` is the message
 * crossing to that recipient, `return` is its acknowledgement coming back.
 *
 * A row leaves when its recipient answers or its own wait ends, so a large
 * group drains nearest first and what stays is who has not been heard.
 */
export function outboundItems(
  outbound: readonly OutboundMessage[],
  utNow: Value<"ut"> | undefined,
  nameFor: (id: RecipientId) => string = (id) => id,
): InFlightListItem[] {
  return outbound.flatMap((out) =>
    out.deliveries.flatMap((delivery): InFlightListItem[] => {
      const phase =
        utNow === undefined
          ? "in-transit"
          : deliveryPhaseFor(out, delivery, utNow);
      if (phase === "confirmed" || phase === "overdue" || phase === "lost") {
        return [];
      }
      // A short crossing needs no box: the words are in the thread already.
      if (isQuickCrossing(delivery)) return [];
      return [
        {
          id: `${out.msg.id}/${delivery.to}`,
          // The words themselves, as the terminal labels a dispatched line with what was typed.
          label: `${messageText(out.msg, nameFor)}, to ${nameFor(delivery.to)}`,
          etaSeconds: etaFor(delivery, phase, utNow),
          phase,
          ...(delivery.queued === true ? { waiting: true, held: true } : {}),
          ...(utNow === undefined
            ? {}
            : { progress: progressFor(delivery, utNow) }),
        },
      ];
    }),
  );
}

/** While the message is crossing a row counts to it reaching its recipient; once it has arrived, to the reply. */
function etaFor(
  delivery: Delivery,
  phase: SentPhase,
  utNow: Value<"ut"> | undefined,
): number | null {
  const trip = roundTripFor(delivery);
  if (trip === null || utNow === undefined) return null;
  const remaining =
    legOf(phase) === "outbound"
      ? trip.reachUt.minus(utNow)
      : legOf(phase) === "return"
        ? trip.replyUt.minus(utNow).max(0)
        : null;
  // The row's countdown takes a plain number of seconds.
  return remaining === null ? null : remaining.magnitude;
}

/** Position on the round trip, 0 at send to 1 at the reply instant. */
function progressFor(delivery: Delivery, utNow: Value<"ut">): number {
  const trip = roundTripFor(delivery);
  if (trip === null) return 0;
  const span = trip.replyUt.minus(delivery.lastSentUt);
  if (!span.isPositive()) return 1;
  // The rail's mark takes a plain fraction.
  const fraction = utNow.minus(delivery.lastSentUt).dividedBy(span).magnitude;
  return Math.max(0, Math.min(1, fraction));
}
