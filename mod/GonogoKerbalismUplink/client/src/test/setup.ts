import "@testing-library/jest-dom";
import {
  AugmentSlot,
  defineUplinkClient,
  installDomStubs,
  PerfBudget,
  registerAugment,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useProcessor, useUtNow } from "@ksp-gonogo/sitrep-client";
import type { GonogoHost } from "@ksp-gonogo/sitrep-sdk";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";

installDomStubs();

// Soft-cap regression gate: any test that pushes a registered PerfBudget over
// its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();

// Bridge the sitrep-sdk facade's fail-loud shims to the SAME real core /
// sitrep-client singletons this suite exercises: mirrors buildGonogoHost()
// member-for-member, scoped to the subset this client's widget actually
// calls (defineUplinkClient + registerComponent + registerAugment at module
// load, the rest at render: useProcessor + AugmentSlot for the
// Processor-backed augments, useTelemetry for a direct `kerbalism.
// spaceweather` Topic read (crew-status.summary, ShipSystems' Radiation
// section), useUtNow for that same Radiation section's rolling-buffer x-axis.
// Without this, the facade shims throw "the gonogo host has not been
// installed" the moment a sealed file renders.
installTestHost({
  AugmentSlot: AugmentSlot as GonogoHost["AugmentSlot"],
  defineUplinkClient,
  registerAugment: registerAugment as GonogoHost["registerAugment"],
  registerComponent,
  useProcessor: useProcessor as GonogoHost["useProcessor"],
  useUtNow: useUtNow as GonogoHost["useUtNow"],
  // Overloaded on the sdk side (canonical one-arg Topic read, and the
  // retired useDataValue's legacy two-arg DataSourceRegistry read carried
  // over onto this same name), mirrors the app's own `buildGonogoHost()`
  // wiring (packages/app/src/uplinks/host.ts) and the render harness's
  // `probe-install-host.ts` member-for-member.
  useTelemetry: ((dataSourceIdOrTopic: string, key?: string) =>
    (useTelemetry as (a: string, b?: string) => unknown)(
      dataSourceIdOrTopic,
      key,
    )) as GonogoHost["useTelemetry"],
});

// This package's Topic registrations, including the unit/shape maps that make a
// decoded kerbalism.* payload's quantities arrive as `Value`s rather than bare
// numbers (see ../topics.ts).
//
// In production the package ENTRY (../index.ts) runs this at module load, long
// before any widget renders, so a consumer can never observe the unregistered
// state: `.` is this package's only export path. A test that imports one widget
// module directly bypasses the entry, so it has to arrange the same side effect
// or it silently tests the unhydrated shape. CrewSurvival/summary.test.tsx is
// the one that proves it matters: it emits a bare rad/s number and asserts the
// dose renders through <Unit> (a `[data-unit]` element), which only happens if
// the value reached the component as a Value.
import "../topics";

// Pin the locale every quantity is written in. It defaults to the READER's
// locale, which is right for an operator and wrong for a snapshot: a render
// on a French machine has to match one on an American CI runner.
setQuantityLocale("en-GB");
