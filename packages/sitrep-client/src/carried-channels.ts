import type { TimelineStore } from "./timeline-store";

/**
 * The carried-channels allowlist gate (see `m3-migration-plan.md`) — the
 * safety mechanism that prevents the "big-bang blank-out": mounting a
 * `TelemetryProvider` used to make `@ksp-gonogo/core`'s
 * `useDataValue` shim stop falling back to legacy for every MAPPED topic,
 * even when the mounted transport never actually delivers it. This module is
 * the single place that decides "is `topic` actually carried right now" —
 * both `TelemetryProvider` (to build the allowlist) and the `useDataValue`
 * shim (to consult it) go through this file rather than duplicating the
 * derived-topic resolution logic.
 *
 * A topic is carried iff EVERY raw wire topic it transitively depends on is
 * in `carriedChannels`:
 * - A raw topic depends only on itself (`store.resolveSubscriptionTopics`'s
 *   identity fallback) — carried iff it's directly in the set.
 * - A DERIVED topic (`vessel.state.*`) depends on its declared `inputs`,
 *   resolved recursively — carried iff ALL of them are (see
 *   `m3-migration-plan.md`: "for a DERIVED topic, it's carried iff all its
 *   declared inputs are carried"). A derived channel with even one uncarried
 *   input can never produce a whole record, so treating it as carried would reintroduce
 *   exactly the permanent-`undefined`-blank-out this gate exists to prevent.
 *
 * Reuses `TimelineStore.resolveSubscriptionTopics` (already the
 * subscription-side source of truth for "what raw topics does this resolve
 * to") rather than re-implementing derived-input resolution here — one
 * seam, not two that can drift apart.
 */
export function isTopicCarried(
  store: Pick<TimelineStore, "resolveSubscriptionTopics">,
  carriedChannels: ReadonlySet<string>,
  topic: string,
): boolean {
  const inputs = store.resolveSubscriptionTopics(topic);
  if (inputs.length === 0) return false;
  return inputs.every((input) => carriedChannels.has(input));
}
