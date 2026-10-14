/**
 * The one place a quantity that may or may not arrive wrapped is unwrapped.
 *
 * Whether a quantity arrives wrapped depends on the topic, not on the type:
 * `wrapTopicPayload` keys on the exact topic string, so a static topic like
 * `trackingStation.catalog` delivers `Value<...>` while a per-guid topic such
 * as `trackingStation.vessel.<guid>.resources` delivers a bare number. A reader that may be
 * handed either has to accept either form.
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
