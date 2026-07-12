import "@testing-library/jest-dom";
import "@testing-library/react"; // ensures IS_REACT_ACT_ENVIRONMENT is set before any test runs
import { installDomStubs, PerfBudget } from "@ksp-gonogo/core";

installDomStubs();

// Soft-cap regression gate: any test that pushes a registered PerfBudget
// over its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();
