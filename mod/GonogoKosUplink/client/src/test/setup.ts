import "@testing-library/jest-dom";
import {
  defineUplinkClient,
  getUplinkHandle,
  installDomStubs,
  PerfBudget,
  registerComponent,
  registerUplinkHandle,
} from "@ksp-gonogo/core";
import { useReplaySessionActive } from "@ksp-gonogo/data";
import { logger } from "@ksp-gonogo/logger";
import {
  getActiveTelemetryClient,
  useCommand,
  useLatestValue,
  useRouteCommands,
  useStream,
  useStreamEvent,
  useTelemetryClientOptional,
  useUtNow,
} from "@ksp-gonogo/sitrep-client";
import type { GonogoHost } from "@ksp-gonogo/sitrep-sdk";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";

installDomStubs();

// Soft-cap regression gate: any test that pushes a registered PerfBudget
// over its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();

// Bridge the sitrep-sdk facade's fail-loud shims to the SAME real core
// singletons this test suite's fixtures (MockKosTelnet-style fakes,
// registerUplinkHandle, clearRegistry, ...) already exercise directly:
// mirrors packages/app/src/uplinks/host.ts's buildGonogoHost() member-for-
// member, scoped to the subset a facade-sealed production file in this
// client actually calls. Without this, any sealed file's hook/registration
// call throws "the gonogo host has not been installed" the moment a test
// renders it, since the sdk shims resolve via `globalThis.__GONOGO_SDK__`,
// not a bundled copy (mod/sitrep-sdk/src/api/host.ts). Partial by design,
// only wire members code under test actually calls (installTestHost's own
// contract).
installTestHost({
  createPerfBudget: (opts) => new PerfBudget(opts),
  defineUplinkClient,
  getActiveTelemetryClient: getActiveTelemetryClient as Parameters<
    typeof installTestHost
  >[0]["getActiveTelemetryClient"],
  getUplinkHandle,
  logger,
  registerComponent,
  registerUplinkHandle: registerUplinkHandle as Parameters<
    typeof installTestHost
  >[0]["registerUplinkHandle"],
  useCommand: (command) =>
    useCommand(command) as unknown as ReturnType<GonogoHost["useCommand"]>,
  useLatestValue,
  useReplaySessionActive,
  useRouteCommands: (topic) =>
    useRouteCommands(topic) as unknown as ReturnType<
      GonogoHost["useRouteCommands"]
    >,
  useStream,
  useStreamEvent,
  useTelemetryClientOptional: useTelemetryClientOptional as Parameters<
    typeof installTestHost
  >[0]["useTelemetryClientOptional"],
  useUtNow,
});

// Pin the locale every quantity is written in. It defaults to the READER's
// locale, which is right for an operator and wrong for a snapshot: a render on
// a French machine has to match one on an American CI runner.
setQuantityLocale("en-GB");
