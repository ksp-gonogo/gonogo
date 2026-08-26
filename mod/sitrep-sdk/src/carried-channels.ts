/**
 * The carried-channels allowlist gate: the safety mechanism against a
 * "big-bang blank-out". Without it, mounting a `TelemetryProvider` stops
 * `@ksp-gonogo/core`'s `useDataValue` shim falling back for every MAPPED
 * topic, including the ones the mounted transport never actually delivers.
 * This module is the single place that decides "is `topic` actually carried
 * right now": both `TelemetryProvider` (to build the allowlist) and the
 * `useDataValue` shim (to consult it) go through this file rather than
 * duplicating the derived-topic resolution logic.
 *
 * A topic is carried iff EVERY raw wire topic it transitively depends on is
 * carried:
 * - A raw topic depends only on itself (`store.resolveSubscriptionTopics`'s
 *   identity fallback): carried iff it's directly in the set (or under a
 *   carried namespace prefix, see below).
 * - A DERIVED topic (`vessel.state.*`) depends on its declared `inputs`,
 *   resolved recursively: carried iff ALL of them are. A derived channel with
 *   even one uncarried
 *   input can never produce a whole record, so treating it as carried would reintroduce
 *   exactly the permanent-`undefined`-blank-out this gate exists to prevent.
 *
 * An allowlist entry is EXACT unless it ends in `.`, in which case it is a
 * carried NAMESPACE PREFIX (`<namespace>.<sub>.`): a raw input is carried when
 * it `startsWith` that prefix. This is how a per-(body,type) DYNAMIC namespace,
 * one whose exact keys can't be enumerated up front (the injected
 * `dynamicWholeTopicPrefixes` topics an Uplink owns): gets promoted to the
 * stream instead of silently falling back to the removed legacy source. A real
 * wire topic never ends in `.`, so a prefix sentinel can never collide with the
 * exact-membership checks elsewhere (`useCommand`, catalog builders). Prefix
 * carrying stays monotonic (it only ever grows coverage) exactly like exact
 * membership, so the "legacy -> stream, never reverse" contract holds.
 *
 * Reuses `TimelineStore.resolveSubscriptionTopics` (already the
 * subscription-side source of truth for "what raw topics does this resolve
 * to") rather than re-implementing derived-input resolution here, one
 * seam, not two that can drift apart.
 */
/**
 * The one thing `isTopicCarried` needs off a timeline store. Structural rather
 * than a `Pick<TimelineStore, ...>`: the store is spine-side and this module is
 * published, so naming the class here would drag the spine across the boundary
 * for a single method.
 */
export interface SubscriptionTopicResolver {
  resolveSubscriptionTopics(topic: string): readonly string[];
}

export function isTopicCarried(
  store: SubscriptionTopicResolver,
  carriedChannels: ReadonlySet<string>,
  topic: string,
): boolean {
  const inputs = store.resolveSubscriptionTopics(topic);
  if (inputs.length === 0) return false;
  return inputs.every((input) => isRawInputCarried(carriedChannels, input));
}

/**
 * One raw wire input is carried iff it is an EXACT allowlist member (the fast
 * path) OR it falls under a carried namespace prefix (an entry ending in `.`).
 * See `isTopicCarried`'s doc for why the trailing-dot prefix form is safe.
 */
function isRawInputCarried(
  carriedChannels: ReadonlySet<string>,
  input: string,
): boolean {
  if (carriedChannels.has(input)) return true;
  for (const entry of carriedChannels) {
    if (entry.endsWith(".") && input.startsWith(entry)) return true;
  }
  return false;
}
