// Type-level tests for the per-widget Topic manifest (spec §3.2 / §3.3).
//
// Enforced by `tsc` (the package `typecheck` script runs them via
// `tsconfig.test-d.json`), NOT by the vitest runner: matching the SDK's
// `topics.test-d.ts` decision (vitest 4's `expectTypeOf` surfacing is unreliable
// in this workspace). Runtime delegation is covered in `defineTopicManifest.test.tsx`.
//
// Everything here is a pure TYPE-level probe (instantiation expressions and
// membership checks, never a runtime hook call), appropriate for a `.test-d.ts`,
// and it sidesteps the `useHookAtTopLevel` lint a top-level `use*()` call would
// trip. Any regression is a compile error:
//   - a required Topic that stops resolving non-null fails an `Expect<Equal<...>>`;
//   - an optional Topic that stops being `| undefined` fails an `Expect<Equal<...>>`;
//   - an undeclared Topic that becomes an accepted argument fails a membership
//     `Expect<...>`.

import type { Reading } from "@ksp-gonogo/sitrep-client";
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

// `typeof hook<"topic">` is an instantiation expression (no call), its ReturnType is
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

/*
 * Every declared Topic resolves to a `Reading` of its payload, required and optional
 * alike.
 *
 * These used to assert that a REQUIRED Topic resolved to its payload non-null while
 * an optional one resolved to `payload | undefined`. That distinction is what the
 * `Reading` union now carries in its own arms, and the old shape had become a lie:
 * the bound hook is built with `as unknown as`, so nothing checked it against the
 * `useTelemetry` it wraps. No widget had adopted a manifest yet, which is the only
 * reason it cost nothing.
 *
 * `Required` still constrains WHICH Topics may be read, which is the mechanism's real
 * value and is asserted at the bottom of this file.
 */
export type _AcRequiredIsReading = Expect<
  Equal<_AcRequired, Reading<VesselResources>>
>;
export type _AcRequired2IsReading = Expect<
  Equal<_AcRequired2, Reading<VesselOrbit>>
>;
export type _AcOptionalIsReading = Expect<
  Equal<_AcOptional, Reading<CommsDelay>>
>;

// ── The same, WITHOUT `as const`: `const` type params make the annotation optional ─
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

export type _PlainRequiredIsReading = Expect<
  Equal<_PlainRequired, Reading<VesselResources>>
>;
export type _PlainOptionalIsReading = Expect<
  Equal<_PlainOptional, Reading<CommsDelay>>
>;

// Proof the read is genuinely NOT the bare payload: the inner `Equal` is FALSE, so
// this only compiles because a manifest read hands back a `Reading`. Were the old
// shape still in force the inner `Equal` would be `true` and the assert would fail.
export type _RequiredIsNotBarePayload = Expect<
  Equal<Equal<_PlainRequired, VesselResources>, false>
>;

// ── Optionality with no optionalChannels at all (defaults to `readonly []`) ─────────
const requiredOnly = defineTopicManifest({ channels: ["vessel.resources"] });
type _RoRequired = ReturnType<
  typeof requiredOnly.useTelemetry<"vessel.resources">
>;
export type _RoRequiredIsReading = Expect<
  Equal<_RoRequired, Reading<VesselResources>>
>;

// ── Reading an UNDECLARED Topic is a compile error ──────────────────────────────────
// The hook only accepts the union of the two declared arrays. `vessel.orbit` is a
// valid TopicId but is NOT declared in `plainManifest`, so it is not an accepted
// argument: proven by the membership check being `false`. A declared Topic IS
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

// ── A DERIVED channel is declarable, a legacy flat key is not ───────────────────────
// The declaration union is `TopicId | DerivedChannelId`, closed on both arms. The
// first assignment is the whole point of widening it: `vessel.state` is the
// most-declared channel in the tree and no widget could name it while `channels`
// was `TopicId[]`. The `@ts-expect-error` lines are the negative controls, and they
// FAIL THE BUILD IF THEY START COMPILING: a legacy flat key that typechecks again is
// how the retired vocabulary comes back, so the assertion that it does not is the
// thing keeping it retired.
const derivedManifest = defineTopicManifest({
  channels: ["vessel.state", "vessel.orbit"],
  optionalChannels: ["spaceCenter.state"],
} as const);

export const _derivedChannelsAssignable: ComponentDefinition["channels"] =
  derivedManifest.channels;
export const _derivedOptionalAssignable: ComponentDefinition["optionalChannels"] =
  derivedManifest.optionalChannels;

// A derived channel is DECLARED but not read through the manifest hook: it is read
// with `useStream`, which answers the value rather than a `Reading`. The wire arm of
// the same manifest still is.
type _DerivedArg = Parameters<typeof derivedManifest.useTelemetry>[0];
export type _DerivedNotAcceptedArg = Expect<
  Equal<"vessel.state" extends _DerivedArg ? true : false, false>
>;
export type _WireStillAcceptedArg = Expect<
  Equal<"vessel.orbit" extends _DerivedArg ? true : false, true>
>;
export type _DerivedWireReadIsReading = Expect<
  Equal<
    ReturnType<typeof derivedManifest.useTelemetry<"vessel.orbit">>,
    Reading<VesselOrbit>
  >
>;

defineTopicManifest({
  // @ts-expect-error a legacy flat key is not a WidgetChannelId
  channels: ["career.funds"],
});

defineTopicManifest({
  // @ts-expect-error a FIELD PATH is not a WidgetChannelId; it collapses to its root
  channels: ["vessel.state.altitudeAsl"],
});

defineTopicManifest({
  channels: ["vessel.orbit"],
  // @ts-expect-error the optional arm is the same closed union
  optionalChannels: ["r.resource[ElectricCharge]"],
});
