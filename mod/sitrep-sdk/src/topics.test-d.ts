// Type-level tests for the typed Topic registry.
//
// These are enforced by `tsc` (the package `typecheck` script runs them via
// `tsconfig.test-d.json`), NOT by the vitest runner — vitest 4's `expectTypeOf`
// surfacing is unreliable in this workspace (it reports "no errors" even for a
// blatant type mismatch), so the type guarantees are gated by a direct compiler pass
// instead. The runtime behaviour + C#-sync guarantees live in `topics.test.ts`.
//
// Any regression here is a compile error: a known Topic that stops resolving to its
// payload fails an `Expect<Equal<…>>`; a widened union that starts accepting unknown
// Topic strings turns an `@ts-expect-error` into an unused-directive error.

import type {
  CommsDelay,
  DockAlignment,
  KosProcessorInfo,
  VesselOrbit,
  VesselResources,
} from "./__generated__/contract";
import type { TopicId, TopicPayload } from "./topics";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// ── A known Topic resolves to its precise contract payload interface ────────────────
export type _ResolvesOrbit = Expect<
  Equal<TopicPayload<"vessel.orbit">, VesselOrbit>
>;
export type _ResolvesResources = Expect<
  Equal<TopicPayload<"vessel.resources">, VesselResources>
>;
export type _ResolvesDelay = Expect<
  Equal<TopicPayload<"comms.delay">, CommsDelay>
>;
export type _ResolvesDock = Expect<
  Equal<TopicPayload<"vessel.dock">, DockAlignment>
>;
export type _ResolvesKosProcessors = Expect<
  Equal<TopicPayload<"kos.processors">, KosProcessorInfo[]>
>;

// ── A Topic whose payload is not yet in the contract resolves to `unknown` ──────────
export type _ResolvesScansatUnknown = Expect<
  Equal<TopicPayload<"scansat.available">, unknown>
>;

// ── An unknown Topic string is a compile error ──────────────────────────────────────
// @ts-expect-error — "vessel.nope" is not a member of the TopicId union
export type _RejectsUnknownTopic = TopicPayload<"vessel.nope">;

// @ts-expect-error — an arbitrary string is not assignable to TopicId
export const _rejectsUnknownId: TopicId = "not.a.real.topic";
