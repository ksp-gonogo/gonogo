import "@testing-library/jest-dom";
import { PerfBudget } from "@ksp-gonogo/core";
import {
  installActGateStretch,
  installDomStubs,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";
import { muteFixtureEmits } from "./setupStreamFixture";

installDomStubs();

// Any test pushing a registered PerfBudget over its threshold fails.
PerfBudget.installTestGate();

// `unfed-snapshot-gate` mutes every stream emit through this env var, read here because setupStreamFixture.tsx is also bundled for the browser.
if (process.env.GONOGO_MUTE_FIXTURE_EMITS === "1") muteFixtureEmits();

// Pin the quantity locale so a snapshot matches on any machine.
setQuantityLocale("en-GB");

// Inert unless the act-warning gate sets its variable. Last, so its afterEach is
// ordered ahead of Testing Library's cleanup; see its doc.
await installActGateStretch();
