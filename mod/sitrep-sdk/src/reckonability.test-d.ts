// Type-level tests for the contract's reckonability declarations.
//
// Enforced by `tsc` via `tsconfig.test-d.json`, same as `units.test-d.ts` and
// for the same reason: vitest 4's `expectTypeOf` is unreliable in this
// workspace, so a direct compiler pass is the gate. Runtime behaviour lives in
// `reckonability.test.ts`, the generated TEXT in
// `generated-reckonability.test.ts`.
//
// Two things are being held. The basis vocabulary exists TWICE on purpose, once
// in C# (`ReckoningBases`, the machine-readable catalogue codegen emits) and
// once hand-written in `reading.ts` (`ReckoningBasis`, which carries the prose
// saying what each model assumes and where it stops being true, and which is
// the most-read documentation in that file). Redefining one as an alias of the
// other loses that prose; a type-level equality is the cheapest thing that fails
// when the two sets drift. And the field unions have to be real keys of the real
// payloads, because `ReckonableReading<T, K>` constrains `K extends keyof T`: a
// stale generated field name must be a compile error at the wiring point rather
// than a `Pick` that silently yields `{}`.

import type { GeneratedReckoningBasis } from "./__generated__/reckonability";
import type { ReckoningBasis } from "./reading";
import type { ReckonableFields, ReckonableTopic } from "./reckonability";
import type { TopicId, TopicPayload } from "./topics";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// The hand-written union and the generated catalogue name the same models.
type _BasisSetsAgree = Expect<Equal<ReckoningBasis, GeneratedReckoningBasis>>;

// Every declared Topic is a real Topic, so `useTelemetry`'s conditional arm can
// never fire on a name the topic map has never heard of.
type _ReckonableTopicsAreTopics = Expect<
  Equal<Extract<ReckonableTopic, TopicId>, ReckonableTopic>
>;

// The per-Topic field unions, spelled out rather than derived, so adding a mark
// is a deliberate edit here as well as in the contract.
type _TargetFields = Expect<
  Equal<ReckonableFields<"vessel.target">, "relativePosition">
>;
type _DockFields = Expect<
  Equal<ReckonableFields<"vessel.dock">, "distance" | "relativePosition">
>;
type _FlightFields = Expect<
  Equal<ReckonableFields<"vessel.flight">, "altitudeAsl" | "orbitalSpeed">
>;
type _OrbitTruthFields = Expect<
  Equal<ReckonableFields<"vessel.orbit.truth">, "position" | "velocity">
>;

// An unmarked Topic answers `never`, which is what makes the conditional in
// `useTelemetry` safe to write over every `TopicId`.
type _UnmarkedIsNever = Expect<Equal<ReckonableFields<"vessel.orbit">, never>>;

// Each declared field is a real key of its real payload. This is the assertion
// that turns a codegen typo into a compile error rather than an empty `Pick`.
type KeysHold<T extends ReckonableTopic> = Equal<
  Extract<ReckonableFields<T>, keyof TopicPayload<T>>,
  ReckonableFields<T>
>;
type _TargetKeys = Expect<KeysHold<"vessel.target">>;
type _DockKeys = Expect<KeysHold<"vessel.dock">>;
type _FlightKeys = Expect<KeysHold<"vessel.flight">>;
type _OrbitTruthKeys = Expect<KeysHold<"vessel.orbit.truth">>;
