import "@testing-library/jest-dom";
import {
  installDomStubs,
  installRealTestHost,
  PerfBudget,
} from "@ksp-gonogo/sitrep-testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";

installDomStubs();

// Soft-cap regression gate: any test that pushes a registered PerfBudget over
// its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();

// Bridge the sitrep-sdk facade's fail-loud shims to the real singletons this
// suite exercises. Every member, not the subset this client happens to call
// today: a test gains nothing from the host lacking members, and a partial host
// fails as `getHost().<member> is not a function` the first time a widget is
// re-pointed at the facade.
installRealTestHost();

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
// locale, which is right for an operator and wrong for a snapshot: a render on
// a French machine has to match one on an American CI runner.
setQuantityLocale("en-GB");
