import "@testing-library/jest-dom";
import {
  AugmentSlot,
  getBody,
  getDataSource,
  getFogRevealSources,
  installDomStubs,
  onFogRevealSourcesChange,
  PerfBudget,
  registerAugment,
  registerComponent,
  registerDataSource,
  registerFogRevealSource,
  registerMapPoiProvider,
  useDataValue,
  useExecuteAction,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useFogMaskCache } from "@ksp-gonogo/data";
import { useLateTelemetrySubscribe } from "@ksp-gonogo/sitrep-client";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";

installDomStubs();

// Soft-cap regression gate: any test that pushes a registered PerfBudget
// over its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();

// Bridge the sitrep-sdk facade's fail-loud shims to the SAME real core/data
// singletons this test suite's fixtures (MockDataSource, registerDataSource,
// clearRegistry, ...) already exercise directly — mirrors
// packages/app/src/uplinks/host.ts's buildGonogoHost() member-for-member,
// scoped to the subset a facade-sealed production file in this client
// actually calls. Without this, any sealed file's hook/registration call
// throws "the gonogo host has not been installed" the moment a test renders
// it, since the sdk shims resolve via `globalThis.__GONOGO_SDK__`, not a
// bundled copy (mod/sitrep-sdk/src/api/host.ts). Partial by design — only
// wire members code under test actually calls (installTestHost's own
// contract).
installTestHost({
  AugmentSlot: AugmentSlot as Parameters<
    typeof installTestHost
  >[0]["AugmentSlot"],
  getBody,
  getDataSource,
  getFogRevealSources,
  onFogRevealSourcesChange,
  registerAugment: registerAugment as Parameters<
    typeof installTestHost
  >[0]["registerAugment"],
  registerComponent,
  registerDataSource: registerDataSource as Parameters<
    typeof installTestHost
  >[0]["registerDataSource"],
  registerFogRevealSource,
  registerMapPoiProvider,
  useDataValue,
  useExecuteAction,
  useTelemetry,
  useFogMaskCache: useFogMaskCache as Parameters<
    typeof installTestHost
  >[0]["useFogMaskCache"],
  useLateTelemetrySubscribe: useLateTelemetrySubscribe as Parameters<
    typeof installTestHost
  >[0]["useLateTelemetrySubscribe"],
});
