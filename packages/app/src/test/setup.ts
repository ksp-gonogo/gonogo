import "@testing-library/jest-dom";
import "@testing-library/react"; // ensures IS_REACT_ACT_ENVIRONMENT is set before any test runs
import { installDomStubs, PerfBudget } from "@ksp-gonogo/core";
import { installGonogoHost } from "../uplinks/host";

installDomStubs();

// The facade-sealed Uplink client packages resolve their stateful surface
// (registerComponent, hooks, …) through the injected gonogo
// host — the same one main.tsx installs at boot. App integration tests that
// import a real sealed client self-register at module load and would throw
// "the gonogo host has not been installed" without this. Install the real
// host so those imports resolve to the real core singletons, matching prod.
installGonogoHost();

// Soft-cap regression gate: any test that pushes a registered PerfBudget
// over its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();
