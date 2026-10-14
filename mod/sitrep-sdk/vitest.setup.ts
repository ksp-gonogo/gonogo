import { PerfBudget } from "./src/perf/PerfBudget";
import { installActGateStretch } from "./src/testing/install-act-gate-stretch";

// Soft-cap regression gate: any test that pushes a registered PerfBudget
// over its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();

// Inert unless the act-warning gate sets its variable. It sits outside `src` so the
// published package does not carry it.
await installActGateStretch();
