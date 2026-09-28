import type { InFlightListItem } from "@ksp-gonogo/ui-kit";
import { messageText } from "./groups";
import {
  legOf,
  roundTripFor,
  type SentPhase,
  type SeparationMatrix,
  sentPhaseFor,
  type Vantage,
} from "./reveal";
import type { OutboundMessage, RecipientId } from "./types";

/**
 * This screen's own words, still out, in the shape the console's queue draws:
 * `outbound` is the message crossing to its recipient, `return` is the
 * acknowledgement coming back.
 *
 * Only `in-transit`, `awaiting-reply` and `due` are reachable. `overdue` and
 * `lost` are exits rather than rows: a message that stops waiting moves into
 * the log as unconfirmed, and a row in both places would be a duplicate.
 */
export function outboundItems(
  outbound: readonly OutboundMessage[],
  me: Vantage,
  utNow: number | undefined,
  pairs: SeparationMatrix | undefined,
  nameFor: (id: RecipientId) => string = (id) => id,
): InFlightListItem[] {
  return outbound.map((out) => {
    const phase =
      utNow === undefined ? "in-transit" : sentPhaseFor(out, me, utNow, pairs);
    return {
      id: out.msg.id,
      // The words themselves, as the terminal labels a dispatched line with what was typed.
      label: messageText(out.msg, nameFor),
      etaSeconds: etaFor(out, phase, utNow),
      phase: phase === "confirmed" ? "due" : phase,
      ...(utNow === undefined ? {} : { progress: progressFor(out, utNow) }),
    };
  });
}

/** While the message is crossing a row counts to it reaching its recipient; once it has arrived, to the reply. */
function etaFor(
  out: OutboundMessage,
  phase: SentPhase,
  utNow: number | undefined,
): number | null {
  const trip = roundTripFor(out.msg);
  if (trip === null || utNow === undefined) return null;
  if (legOf(phase) === "outbound") return trip.reachUt - utNow;
  if (legOf(phase) === "return") return Math.max(0, trip.replyUt - utNow);
  return null;
}

/** Position on the round trip, 0 at send to 1 at the reply instant. */
function progressFor(out: OutboundMessage, utNow: number): number {
  const trip = roundTripFor(out.msg);
  if (trip === null) return 0;
  const span = trip.replyUt - out.msg.lastSentUt;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (utNow - out.msg.lastSentUt) / span));
}
