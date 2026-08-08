import "@testing-library/jest-dom";
import {
  AugmentSlot,
  defineUplinkClient,
  installDomStubs,
  PerfBudget,
  registerComponent,
  useActionInput,
  useExecuteAction,
  useTelemetry,
} from "@ksp-gonogo/core";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";

installDomStubs();

// Soft-cap regression gate: any test that pushes a registered PerfBudget
// over its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();

// Bridge the sitrep-sdk facade's fail-loud shims to the SAME real core
// singletons this test suite's fixtures (the stream test-adapter,
// clearActionHandlers, ...) already exercise directly: mirrors
// packages/app/src/uplinks/host.ts's buildGonogoHost() member-for-member,
// scoped to the subset a facade-sealed production file in this client
// actually calls. Without this, any sealed file's hook/registration call
// throws "the gonogo host has not been installed" the moment a test renders
// it, since the sdk shims resolve via `globalThis.__GONOGO_SDK__`, not a
// bundled copy (mod/sitrep-sdk/src/api/host.ts). Partial by design: only
// wire members code under test actually calls (installTestHost's own
// contract). `useCommand` is NOT part of this list: RoboticsConsole/
// RotorTachometer import it straight from `@ksp-gonogo/sitrep-client`, a
// real dependency, not a sealed-host shim.
installTestHost({
  AugmentSlot: AugmentSlot as Parameters<
    typeof installTestHost
  >[0]["AugmentSlot"],
  defineUplinkClient,
  registerComponent,
  useActionInput: useActionInput as Parameters<
    typeof installTestHost
  >[0]["useActionInput"],
  useExecuteAction,
  useTelemetry,
});

// Pin the locale every quantity is written in. It defaults to the READER's
// locale, which is right for an operator and wrong for a snapshot: a render on
// a French machine has to match one on an American CI runner.
setQuantityLocale("en-GB");
