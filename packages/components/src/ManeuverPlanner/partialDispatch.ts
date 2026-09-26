/**
 * What to tell the operator when a multi-burn plan stops part-way through: the
 * burns before the failure are really in KSP, so that comes first, then why it
 * stopped.
 */
export function describePartialDispatch(args: {
  /** Burns that were dispatched and acknowledged before the failure. */
  dispatched: number;
  /** Burns in the whole plan. */
  total: number;
  /** The underlying failure, carried verbatim. */
  reason: string;
}): string {
  const { dispatched, total, reason } = args;
  // A single-burn plan has nothing to count.
  if (total <= 1) return reason;
  return `${dispatched} of ${total} burns dispatched. Burn ${dispatched + 1} failed: ${reason}`;
}
