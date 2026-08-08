import "@testing-library/jest-dom";
import {
  defineUplinkClient,
  installDomStubs,
  PerfBudget,
  registerComponent,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";

installDomStubs();

// Soft-cap regression gate: any test that pushes a registered PerfBudget
// over its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();

// Bridge the sitrep-sdk facade's fail-loud shims to the SAME real core/
// sitrep-client singletons this widget actually calls: mirrors
// packages/app/src/uplinks/host.ts's buildGonogoHost() member-for-member,
// scoped to the subset a facade-sealed production file in this client
// actually calls (registerComponent, useActionInput, useTelemetry,
// useCommand: the whole of what MechJeb/index.tsx imports from
// @ksp-gonogo/core / @ksp-gonogo/sitrep-client). Without this, a sealed
// file's hook/registration call throws "the gonogo host has not been
// installed" the moment a test renders it, since the sdk shims resolve via
// `globalThis.__GONOGO_SDK__`, not a bundled copy. Partial by design: only
// wire members code under test actually calls (installTestHost's own
// contract, see GonogoScansatUplink/GonogoKosUplink's identical setups).
installTestHost({
  defineUplinkClient,
  registerComponent,
  useActionInput: useActionInput as Parameters<
    typeof installTestHost
  >[0]["useActionInput"],
  useCommand: ((command: string) => useCommand(command)) as Parameters<
    typeof installTestHost
  >[0]["useCommand"],
  useTelemetry,
});

// Pin the locale every quantity is written in. It defaults to the READER's
// locale, which is right for an operator and wrong for a snapshot: a render on
// a French machine has to match one on an American CI runner.
setQuantityLocale("en-GB");
