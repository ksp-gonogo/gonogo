/**
 * What to tell the operator when a multi-burn plan stops part-way through.
 *
 * A dispatch that is never answered now settles as an error rather than hanging for
 * ever, which aborts the commit loop at the burn that failed. That is the fix, and on
 * its own it leaves the operator where the silent hang left them: knowing something
 * went wrong and NOT knowing what state the vessel's flight plan is in.
 *
 * Burns before the failure are really in KSP. That is a fact about the world the
 * operator needs before they touch anything else, because it is the difference between
 * re-planning from the next burn and re-planning from scratch on top of nodes that
 * already exist.
 *
 * Two facts, in the order they are needed: what is true of the vessel now, then why it
 * stopped. The unsent remainder is left implied by the count rather than spelled out in
 * a third clause, which is the clause that gets truncated.
 */
export function describePartialDispatch(args: {
  /** Burns that were dispatched and acknowledged before the failure. */
  dispatched: number;
  /** Burns in the whole plan. */
  total: number;
  /** The underlying failure, carried VERBATIM: never summarised into the sentence. */
  reason: string;
}): string {
  const { dispatched, total, reason } = args;
  // A single-burn plan needs no arithmetic: nothing landed and nothing was abandoned,
  // so "0 of 1 burns dispatched" is noise in front of the only fact there is.
  if (total <= 1) return reason;
  return `${dispatched} of ${total} burns dispatched. Burn ${dispatched + 1} failed: ${reason}`;
}
