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
  CareerStatus,
  CommsDelay,
  DeployedEntry,
  DockAlignment,
  ExperimentEntry,
  KosProcessorInfo,
  LabEntry,
  PartsPower,
  ScanningVesselEntry,
  ServoEntry,
  SystemBodies,
  SystemVessels,
  VesselOrbit,
  VesselResources,
} from "./__generated__/contract";
import type { TopicId, TopicPayload } from "./topics";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// ── vessel.* / comms.* / kos.* known Topics resolve to their precise interface ──────
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

// ── career.* / parts.* / system.* / science.* now resolve to their REAL contract
//    payload type (formerly `unknown` — P0.5 typed them, codegen wired them in) ──────
export type _ResolvesCareer = Expect<
  Equal<TopicPayload<"career.status">, CareerStatus>
>;
export type _ResolvesPartsPower = Expect<
  Equal<TopicPayload<"parts.power">, PartsPower>
>;
// The bare-array channels resolve to `Element[]`, not a wrapper object.
export type _ResolvesPartsRobotics = Expect<
  Equal<TopicPayload<"parts.robotics">, ServoEntry[]>
>;
export type _ResolvesScienceExperiments = Expect<
  Equal<TopicPayload<"science.experiments">, ExperimentEntry[]>
>;
export type _ResolvesScienceLab = Expect<
  Equal<TopicPayload<"science.lab">, LabEntry[]>
>;
export type _ResolvesScienceDeployed = Expect<
  Equal<TopicPayload<"science.deployed">, DeployedEntry[]>
>;
export type _ResolvesSystemBodies = Expect<
  Equal<TopicPayload<"system.bodies">, SystemBodies>
>;
export type _ResolvesSystemVessels = Expect<
  Equal<TopicPayload<"system.vessels">, SystemVessels>
>;

// ── scansat: `scansat.available` is a bare JSON boolean with no named contract type
//    (see topics.ts header); `scansat.scanningVessels` now carries the wire-typed
//    `ScanningVesselEntry[]` element contract ──────────────────────────────────────
export type _ResolvesScansatAvailable = Expect<
  Equal<TopicPayload<"scansat.available">, boolean>
>;
export type _ResolvesScansatScanningVessels = Expect<
  Equal<TopicPayload<"scansat.scanningVessels">, ScanningVesselEntry[]>
>;

// ── No Topic resolves to `unknown` (the whole point of P0.5) ────────────────────────
// Same construction as topics.ts's `_AssertNoTopicResolvesToUnknown`, asserted here too
// so a regression is caught even if the compile-time assert in topics.ts is refactored.
type IsAny<T> = 0 extends 1 & T ? true : false;
type IsUnknown<T> =
  IsAny<T> extends true ? false : unknown extends T ? true : false;
export type _NoTopicIsUnknown = Expect<
  Equal<{ [K in TopicId]: IsUnknown<TopicPayload<K>> }[TopicId], false>
>;

// ── An unknown Topic string is a compile error ──────────────────────────────────────
// @ts-expect-error — "vessel.nope" is not a member of the TopicId union
export type _RejectsUnknownTopic = TopicPayload<"vessel.nope">;

// @ts-expect-error — an arbitrary string is not assignable to TopicId
export const _rejectsUnknownId: TopicId = "not.a.real.topic";
