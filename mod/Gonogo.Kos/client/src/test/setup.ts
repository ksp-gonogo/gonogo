import "@testing-library/jest-dom";
import { installDomStubs, PerfBudget } from "@ksp-gonogo/core";

installDomStubs();

// Soft-cap regression gate: any test that pushes a registered PerfBudget
// over its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();
