import {
  AugmentSlot,
  getGameHost,
  getUplinkHandle,
  installDomStubs,
  PerfBudget,
  registerAugment,
  registerComponent,
  registerSetting,
  registerSettingsTab,
  registerUplinkHandle,
  subscribeSetting,
  useActionInput,
  useSetting,
  useTelemetry,
} from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import {
  useCommand,
  useLatestValue,
  useViewClockOptional,
} from "@ksp-gonogo/sitrep-client";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";

installDomStubs();
PerfBudget.installTestGate();

// Bridge the sitrep-sdk facade's fail-loud shims to the SAME real core /
// sitrep-client singletons this test suite's fixtures (MockSidecar,
// registerDataSource, clearRegistry, ...) already exercise directly:
// mirrors packages/app/src/uplinks/host.ts's buildGonogoHost() member-for-
// member, scoped to the subset a facade-sealed production file in this
// client actually calls. Without this, any sealed file's hook/registration
// call throws "the gonogo host has not been installed" the moment a test
// renders it, since the sdk shims resolve via `globalThis.__GONOGO_SDK__`,
// not a bundled copy (mod/sitrep-sdk/src/api/host.ts). Partial by design,
// only wire members code under test actually calls (installTestHost's own
// contract).
installTestHost({
  AugmentSlot: AugmentSlot as Parameters<
    typeof installTestHost
  >[0]["AugmentSlot"],
  createPerfBudget: (opts) => new PerfBudget(opts),
  getGameHost,
  getUplinkHandle,
  logger,
  registerAugment: registerAugment as Parameters<
    typeof installTestHost
  >[0]["registerAugment"],
  registerComponent,
  registerSetting,
  registerSettingsTab,
  registerUplinkHandle: registerUplinkHandle as Parameters<
    typeof installTestHost
  >[0]["registerUplinkHandle"],
  subscribeSetting,
  useActionInput,
  useCommand: useCommand as Parameters<typeof installTestHost>[0]["useCommand"],
  useLatestValue,
  useSetting,
  useTelemetry,
  useViewClockOptional,
});

// Pin the locale every quantity is written in. It defaults to the READER's
// locale, which is right for an operator and wrong for a snapshot: a render on
// a French machine has to match one on an American CI runner.
setQuantityLocale("en-GB");
