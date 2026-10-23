import { isSettled, type SentPhase } from "./reveal";
import type { Delivery } from "./types";

/**
 * What a sent message's hover list says about one recipient: that it was
 * received, that it never left (and why, when the contact plan says), that it
 * is still on the way, or that its wait ran out without an answer.
 */
export function recipientWords(
  phase: SentPhase,
  delivery: Delivery,
  noReachReason?: "unpowered",
): string {
  if (phase === "confirmed") return "received";
  if (delivery.neverLeft) {
    return noReachReason === "unpowered"
      ? "never left, no electric charge aboard"
      : "never left, no path";
  }
  return isSettled(phase) ? "not received" : "on the way";
}
