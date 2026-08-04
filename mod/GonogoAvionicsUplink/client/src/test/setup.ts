import "@testing-library/jest-dom";
import {
  installDomStubs,
  PerfBudget,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";

installDomStubs();

// Soft-cap regression gate: any test that pushes a registered PerfBudget over
// its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();

// Bridge the sitrep-sdk facade's fail-loud shims to the SAME real core
// singletons this suite exercises: mirrors buildGonogoHost() member-for-member,
// scoped to the subset this client's widget actually calls (registerComponent at
// module load, useTelemetry at render). Without this, the facade shims throw
// "the gonogo host has not been installed" the moment a sealed file renders.
installTestHost({
  registerComponent,
  useTelemetry,
});

// Pin the locale every quantity is written in. It defaults to the READER's
// locale, which is right for an operator and wrong for a snapshot: a render on
// a French machine has to match one on an American CI runner.
setQuantityLocale("en-GB");
