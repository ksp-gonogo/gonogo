import "@testing-library/jest-dom";
import {
  AugmentSlot,
  defineUplinkClient,
  installDomStubs,
  PerfBudget,
  registerAugment,
  registerComponent,
} from "@ksp-gonogo/core";
import { useProcessor } from "@ksp-gonogo/sitrep-client";
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
// load, the last one added when the Greenhouse augment moved into this
// package alongside the Ship Systems rebuild; useProcessor + AugmentSlot at
// render). Without this, the facade shims throw "the gonogo host has not
// been installed" the moment a sealed file renders.
installTestHost({
  AugmentSlot: AugmentSlot as GonogoHost["AugmentSlot"],
  defineUplinkClient,
  registerAugment: registerAugment as GonogoHost["registerAugment"],
  registerComponent,
  useProcessor: useProcessor as GonogoHost["useProcessor"],
});

// Pin the locale every quantity is written in. It defaults to the READER's
// locale, which is right for an operator and wrong for a snapshot: a render
// on a French machine has to match one on an American CI runner.
setQuantityLocale("en-GB");
