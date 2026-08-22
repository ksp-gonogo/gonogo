/**
 * The one place a `fleet.` payload's quantity is unwrapped.
 *
 * Whether a quantity arrives wrapped depends on the TOPIC, not on the type:
 * `wrapTopicPayload` keys on the exact topic string, so a static topic like
 * `fleet.silence` delivers `Value<...>` while its per-guid sibling
 * `fleet.<guid>.resources` delivers a bare number, for the same field of the
 * same shape. A reader of both has to accept either form.
 *
 * This is a decode, not arithmetic: the number is handed straight to a caller
 * and never computed with here, which is why it unwraps rather than routing
 * through the algebra. Null for anything unreadable, so a caller can tell a
 * missing reading from a zero one.
 */
export function wireMagnitude(
  v: { magnitude: number } | number | null | undefined,
): number | null {
  const n = typeof v === "object" && v !== null ? v.magnitude : v;
  return n == null || !Number.isFinite(n) ? null : n;
}
