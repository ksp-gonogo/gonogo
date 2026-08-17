import "@testing-library/jest-dom";
import { installDomStubs, PerfBudget } from "@ksp-gonogo/core";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";
import { muteFixtureEmits } from "./setupStreamFixture";

installDomStubs();

// Soft-cap regression gate: any test that pushes a registered PerfBudget
// over its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();

// `unfed-snapshot-gate` re-runs the snapshot specs with every stream emit
// suppressed, and asks vitest for it through this env var. Read HERE rather than
// in setupStreamFixture.tsx, which is bundled for the browser by the probe render
// harness: a module-scope `process` read there threw `process is not defined` and
// silently stopped all 42 widgets rendering (see probe-render-smoke.ts). setupFiles
// run before any test module, so one read per run still lands before the first
// fixture is built.
if (process.env.GONOGO_MUTE_FIXTURE_EMITS === "1") muteFixtureEmits();

// Pin the locale every quantity is written in. It defaults to the READER's
// locale, which is right for an operator and wrong for a snapshot: a render on
// a French machine has to match one on an American CI runner.
setQuantityLocale("en-GB");
