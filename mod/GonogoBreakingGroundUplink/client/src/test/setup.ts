import "@testing-library/jest-dom";
import {
  AugmentSlot,
  defineUplinkClient,
  installDomStubs,
  PerfBudget,
  registerAugment,
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
// contract). `useCommand` is NOT on this list, and cannot be yet: RoboticsConsole
// and RotorTachometer still import it from `@ksp-gonogo/sitrep-client` directly.
// Re-pointing them at the sdk facade needs a real `useCommand` HERE, and the only
// place to get one is `sitrep-client`, which would move the violation into this
// file rather than remove it. Blocked on a published harness above the spine.
installTestHost({
  AugmentSlot: AugmentSlot as Parameters<
    typeof installTestHost
  >[0]["AugmentSlot"],
  defineUplinkClient,
  registerAugment: registerAugment as Parameters<
    typeof installTestHost
  >[0]["registerAugment"],
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
