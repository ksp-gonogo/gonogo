import "@testing-library/jest-dom";
import { PerfBudget } from "@ksp-gonogo/sitrep-sdk";
import {
  installActGateStretch,
  installDomStubs,
  installRealTestHost,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  AugmentSlot,
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
  setQuantityLocale,
} from "@ksp-gonogo/ui-kit";

installDomStubs();

// Any test that pushes a registered PerfBudget over its threshold fails.
PerfBudget.installTestGate();

// The augment members come from ui-kit, which imports the sdk, so the sdk cannot supply them itself.
installRealTestHost({
  AugmentSlot,
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
});

// Quantities default to the reader's locale, so snapshots pin one.
setQuantityLocale("en-GB");

// Inert unless the act-warning gate sets its variable. Last, so its afterEach is
// ordered ahead of Testing Library's cleanup; see its doc.
await installActGateStretch();
