import "fake-indexeddb/auto";
import { PerfBudget } from "@gonogo/core";

// Soft-cap regression gate: any test that pushes a registered PerfBudget
// over its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();
