import "fake-indexeddb/auto";
import { PerfBudget } from "@ksp-gonogo/core";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";

// Soft-cap regression gate: any test that pushes a registered PerfBudget
// over its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();

// Pin the locale every quantity is written in. It defaults to the READER's
// locale, which is right for an operator and wrong for a snapshot: a render on
// a French machine has to match one on an American CI runner.
setQuantityLocale("en-GB");

// The act-warning gate's post-body wait, imported only when the gate asks for it so
// an ordinary run never loads the testing barrel. Last, so its afterEach is ordered
// ahead of Testing Library's cleanup; see installActGateStretch.
if (process.env.GONOGO_ACT_GATE_STRETCH_FRAMES) {
  const { installActGateStretch } = await import(
    "@ksp-gonogo/sitrep-sdk/testing"
  );
  await installActGateStretch();
}
