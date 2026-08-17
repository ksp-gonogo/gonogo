import type { ReckonerFor } from "./reading";

/**
 * Per-topic forward models, registered at module load the same way components
 * and themes are: a module that owns a model calls `registerReckoner` and the
 * store picks it up, with no wiring in between.
 *
 * A module-level registry rather than a `TimelineStore` method because the model
 * belongs to whoever owns the topic (a widget, an Uplink), and that module is
 * imported long before any store exists. The store consults this lazily, per
 * reading, so a registration made after a store was built still takes effect.
 *
 * One reckoner per topic, last registration wins, so a model can be elected the
 * same way the propagator is.
 */
const reckoners = new Map<string, ReckonerFor<unknown>>();

export function registerReckoner<T>(
  topic: string,
  reckoner: ReckonerFor<T>,
): void {
  reckoners.set(topic, reckoner as ReckonerFor<unknown>);
}

export function getReckoner<T>(topic: string): ReckonerFor<T> | undefined {
  return reckoners.get(topic) as ReckonerFor<T> | undefined;
}

/** Test-only: reset the registry to empty. */
export function clearReckoners(): void {
  reckoners.clear();
}
