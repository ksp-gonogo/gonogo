import { isSettled, type SentPhase } from "./reveal";
import type { Delivery } from "./types";

/** What the app knows about a recipient apart from the delivery itself. */
export interface RecipientAbout {
  /** Why the contact plan has no reach to the recipient, when it says. */
  noReachReason?: "unpowered";
}

/**
 * What a sent message's hover list says about one recipient: that it was
 * delivered (and read, when a screen there said so), that the game refused it,
 * that it never left (and why, when the contact plan says), that it is still on
 * the way, or that no arrival was recorded in the time it was expected.
 */
export function recipientWords(
  phase: SentPhase,
  delivery: Delivery,
  about: RecipientAbout = {},
  read = false,
): string {
  if (phase === "confirmed") return read ? "delivered, read" : "delivered";
  if (delivery.refused) {
    return delivery.refusedReason === undefined
      ? "not sent, the game refused it"
      : `not sent, ${delivery.refusedReason}`;
  }
  if (delivery.queued && !isSettled(phase)) return "waiting for a path";
  if (delivery.neverLeft) {
    return about.noReachReason === "unpowered"
      ? "never left, no electric charge aboard"
      : "never left, no path";
  }
  if (!isSettled(phase)) return "on the way";
  return "no arrival recorded";
}
