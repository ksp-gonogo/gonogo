/**
 * The Topics this client knows about because a client package SAID SO at
 * module load, as opposed to the ones a generated map or a hand-written list in
 * the gonogo repo names.
 *
 * An Uplink's Topics can never appear in a list written in this repo: it ships
 * separately, on its own schedule, and the first-party build has never heard of
 * it. What it does do, because narrowing and decode already require it, is call
 * `registerBarePrimitiveTopic` for each Topic id when its client package loads.
 * That call is the only runtime advertisement of an Uplink's Topics that
 * exists, so it is what everything downstream that needs "which Topics are real
 * right now" has to read.
 *
 * `registerTopicUnits` deliberately does NOT enrol a Topic here: a
 * client-derived channel declares its fields through it too, and nothing puts a
 * derived channel on the wire, so a units declaration is not evidence that
 * anything sends the Topic.
 *
 * Two consumers, and they are the two surfaces an Uplink was structurally shut
 * out of: the field catalogue every picker offers from (a Topic nobody listed
 * enumerated no fields, so no Uplink value could be graphed or alarmed on), and
 * `TelemetryProvider`'s carried-channels allowlist (a Topic nobody listed was
 * not promoted to the stream, so even a picked field plotted nothing).
 *
 * Snapshot-shaped and subscribable because registration happens when the
 * Uplink's bundle loads, which is after the app has rendered. A consumer that
 * read this once at module load would be back to a fixed list, just a
 * differently-sourced one.
 */

const runtimeTopicIds = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: readonly string[] = Object.freeze([]);

function invalidate(): void {
  snapshot = Object.freeze([...runtimeTopicIds]);
  for (const listener of listeners) listener();
}

/**
 * Record that `id` is a real Topic on this client. Called by
 * `registerBarePrimitiveTopic`, never directly by an Uplink: an author
 * registers the way they already do and this follows.
 */
export function noteRuntimeTopic(id: string): void {
  if (runtimeTopicIds.has(id)) return;
  runtimeTopicIds.add(id);
  invalidate();
}

/**
 * Record that a registration changed what a Topic ENUMERATES without vouching
 * for a new Topic: `registerTopicUnits` and `registerTypeUnits`. The id list is
 * unchanged and the snapshot's identity still moves, because a catalogue built
 * between an Uplink's Topic registration and its unit registration would
 * otherwise hold that Topic's fields as empty until something else invalidated
 * it.
 */
export function noteRuntimeTopicMetadata(): void {
  invalidate();
}

/**
 * Every Topic a client package has registered at runtime, in registration
 * order.
 *
 * Identity-stable between registrations, so it can be a `useSyncExternalStore`
 * snapshot and a `useMemo` dependency directly. Pair with
 * {@link subscribeRuntimeTopicRegistry}.
 */
export function getRuntimeRegisteredTopicIds(): readonly string[] {
  return snapshot;
}

/** Fires whenever a registration changes the snapshot. Returns the unsubscribe. */
export function subscribeRuntimeTopicRegistry(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
