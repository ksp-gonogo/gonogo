import type { DerivedGet, TimelinePoint } from "@ksp-gonogo/sitrep-sdk";

/**
 * A `DerivedGet` serving a fixed topic → point map, for a derivation under test.
 *
 * `DerivedGet` is generic in its CALLER: `<T>(topic) => TimelinePoint<T>`, where
 * the derivation picks `T` per read. No implementation can satisfy every `T` at
 * once, so the erasure that makes one is here, in one place, rather than in each
 * test's own fake.
 *
 * `onRead` fires per read, for a test asserting which topics a derivation asks
 * for or at what view time it asks.
 */
export function derivedGetOf(
  points: Record<string, TimelinePoint<unknown> | undefined>,
  onRead?: (topic: string) => void,
): DerivedGet {
  return (<T>(topic: string) => {
    onRead?.(topic);
    return points[topic] as TimelinePoint<T> | undefined;
  }) as DerivedGet;
}
