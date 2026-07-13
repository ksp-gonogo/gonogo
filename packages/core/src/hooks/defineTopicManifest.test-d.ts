// Type-level tests for the per-widget Topic manifest (spec §3.2 / §3.3).
//
// Enforced by `tsc` (the package `typecheck` script runs them via
// `tsconfig.test-d.json`), NOT by the vitest runner — matching the SDK's
// `topics.test-d.ts` decision (vitest 4's `expectTypeOf` surfacing is unreliable
// in this workspace). Runtime delegation is covered in `defineTopicManifest.test.tsx`.
//
// Everything here is a pure TYPE-level probe (instantiation expressions and
// membership checks, never a runtime hook call) — appropriate for a `.test-d.ts`,
// and it sidesteps the `useHookAtTopLevel` lint a top-level `use*()` call would
// trip. Any regression is a compile error:
//   - a required Topic that stops resolving non-null fails an `Expect<Equal<...>>`;
//   - an optional Topic that stops being `| undefined` fails an `Expect<Equal<...>>`;
//   - an undeclared Topic that becomes an accepted argument fails a membership
//     `Expect<...>`.

import type {
  CommsDelay,
  VesselOrbit,
  VesselResources,
} from "@ksp-gonogo/sitrep-sdk";
import type { ComponentDefinition } from "../types";
import { defineTopicManifest } from "./defineTopicManifest";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// ── The `as const` ergonomics the spike must prove ──────────────────────────────────
// Both arrays authored with `as const`; the narrow tuple types flow through and the
// required/optional distinction is inferred, no per-Value annotation anywhere.
const asConstManifest = defineTopicManifest({
  channels: ["vessel.resources", "vessel.orbit"],
  optionalChannels: ["comms.delay"],
} as const);

// `typeof hook<"topic">` is an instantiation expression (no call) — its ReturnType is
// exactly what a real `topics.useTelemetry("topic")` read would yield.
type _AcRequired = ReturnType<
  typeof asConstManifest.useTelemetry<"vessel.resources">
>;
type _AcRequired2 = ReturnType<
  typeof asConstManifest.useTelemetry<"vessel.orbit">
>;
type _AcOptional = ReturnType<
  typeof asConstManifest.useTelemetry<"comms.delay">
>;

// Required Topics resolve NON-NULL (strict `Equal` — a `| undefined` here would fail).
export type _AcRequiredNonNull = Expect<Equal<_AcRequired, VesselResources>>;
export type _AcRequired2NonNull = Expect<Equal<_AcRequired2, VesselOrbit>>;
// Optional Topics resolve to `payload | undefined`.
export type _AcOptionalUndefined = Expect<
  Equal<_AcOptional, CommsDelay | undefined>
>;

// ── The same, WITHOUT `as const` — `const` type params make the annotation optional ─
const plainManifest = defineTopicManifest({
  channels: ["vessel.resources"],
  optionalChannels: ["comms.delay"],
});

type _PlainRequired = ReturnType<
  typeof plainManifest.useTelemetry<"vessel.resources">
>;
type _PlainOptional = ReturnType<
  typeof plainManifest.useTelemetry<"comms.delay">
>;

export type _PlainRequiredNonNull = Expect<
  Equal<_PlainRequired, VesselResources>
>;
export type _PlainOptionalUndefined = Expect<
  Equal<_PlainOptional, CommsDelay | undefined>
>;

// Proof the required branch is genuinely NOT `| undefined`: the inner `Equal` is
// FALSE, so the outer `Expect<...>` only compiles because the required read is
// non-nullable (were it nullable, the inner `Equal` would be `true`, the negation
// `false`, and the assert would fail).
export type _RequiredIsNotNullable = Expect<
  Equal<Equal<_PlainRequired, VesselResources | undefined>, false>
>;

// ── Optionality with no optionalChannels at all (defaults to `readonly []`) ─────────
const requiredOnly = defineTopicManifest({ channels: ["vessel.resources"] });
type _RoRequired = ReturnType<
  typeof requiredOnly.useTelemetry<"vessel.resources">
>;
export type _RoRequiredNonNull = Expect<Equal<_RoRequired, VesselResources>>;

// ── Reading an UNDECLARED Topic is a compile error ──────────────────────────────────
// The hook only accepts the union of the two declared arrays. `vessel.orbit` is a
// valid TopicId but is NOT declared in `plainManifest`, so it is not an accepted
// argument — proven by the membership check being `false`. A declared Topic IS
// accepted; a non-TopicId string is not.
type _PlainArg = Parameters<typeof plainManifest.useTelemetry>[0];
export type _OrbitNotAcceptedArg = Expect<
  Equal<"vessel.orbit" extends _PlainArg ? true : false, false>
>;
export type _ResourcesAcceptedArg = Expect<
  Equal<"vessel.resources" extends _PlainArg ? true : false, true>
>;
export type _JunkNotAcceptedArg = Expect<
  Equal<"totally.made.up" extends _PlainArg ? true : false, false>
>;

// ── The arrays are assignable to the ComponentDefinition surface ────────────────────
// Proves `channels` / `optionalChannels` spread straight into `registerComponent`.
export const _channelsAssignable: ComponentDefinition["channels"] =
  asConstManifest.channels;
export const _optionalAssignable: ComponentDefinition["optionalChannels"] =
  asConstManifest.optionalChannels;
