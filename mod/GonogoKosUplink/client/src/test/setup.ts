import "@testing-library/jest-dom";
import {
  getDataSource,
  getUplinkHandle,
  installDomStubs,
  PerfBudget,
  registerComponent,
  registerDataSource,
  registerUplinkHandle,
} from "@ksp-gonogo/core";
import { useReplaySessionActive } from "@ksp-gonogo/data";
import { logger } from "@ksp-gonogo/logger";
import {
  getActiveTelemetryClient,
  useCommand,
  useLatestValue,
  useStream,
  useStreamEvent,
  useTelemetryClientOptional,
  useUtNow,
} from "@ksp-gonogo/sitrep-client";
import type { GonogoHost } from "@ksp-gonogo/sitrep-sdk";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";

installDomStubs();

// Soft-cap regression gate: any test that pushes a registered PerfBudget
// over its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();

// Bridge the sitrep-sdk facade's fail-loud shims to the SAME real core
// singletons this test suite's fixtures (MockKosTelnet-style fakes,
// registerDataSource, clearRegistry, ...) already exercise directly —
// mirrors packages/app/src/uplinks/host.ts's buildGonogoHost() member-for-
// member, scoped to the subset a facade-sealed production file in this
// client actually calls. Without this, any sealed file's hook/registration
// call throws "the gonogo host has not been installed" the moment a test
// renders it, since the sdk shims resolve via `globalThis.__GONOGO_SDK__`,
// not a bundled copy (mod/sitrep-sdk/src/api/host.ts). Partial by design —
// only wire members code under test actually calls (installTestHost's own
// contract).
installTestHost({
  createPerfBudget: (opts) => new PerfBudget(opts),
  getActiveTelemetryClient: getActiveTelemetryClient as Parameters<
    typeof installTestHost
  >[0]["getActiveTelemetryClient"],
  getDataSource,
  getUplinkHandle,
  logger,
  registerComponent,
  registerDataSource: registerDataSource as Parameters<
    typeof installTestHost
  >[0]["registerDataSource"],
  registerUplinkHandle: registerUplinkHandle as Parameters<
    typeof installTestHost
  >[0]["registerUplinkHandle"],
  useCommand: (command) =>
    useCommand(command) as unknown as ReturnType<GonogoHost["useCommand"]>,
  useLatestValue,
  useReplaySessionActive,
  useStream,
  useStreamEvent,
  useTelemetryClientOptional: useTelemetryClientOptional as Parameters<
    typeof installTestHost
  >[0]["useTelemetryClientOptional"],
  useUtNow,
});
