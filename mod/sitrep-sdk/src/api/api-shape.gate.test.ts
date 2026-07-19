import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestHost, resetTestHost } from "../testing";
import * as barrel from "./index";

/**
 * The author-surface shape gate — the TS analogue of the C# ContractShapeGate,
 * applied to the curated barrel. It records the CURRENT proposed export surface
 * (design D-D, not yet frozen) so any change to what third-party authors can
 * import is a DELIBERATE edit to this list, not an accident. When the operator
 * signs off the surface, this list becomes the frozen baseline that gates
 * `EXTENSION_API_VERSION`.
 *
 * Only runtime VALUE exports appear here (types are erased at runtime); the
 * type surface is locked separately by api-shape.test-d.ts.
 */
const EXPECTED_BARREL_VALUE_EXPORTS = [
  "AugmentSlot",
  "GAME_HOST_KEY",
  "GONOGO_HOST_KEY",
  "LocalStorageStore",
  "createPerfBudget",
  "getActiveTelemetryClient",
  "getBody",
  "getFogRevealSources",
  "getGameHost",
  "getUplinkHandle",
  "hasHost",
  "logger",
  "onFogRevealSourcesChange",
  "registerAugment",
  "registerComponent",
  "registerFogRevealSource",
  "registerMapPoiProvider",
  "registerSettingsTab",
  "registerTheme",
  "registerUplinkHandle",
  "safeRandomUuid",
  "subscribeSetting",
  "useActionInput",
  "useCommand",
  "useDataSchema",
  "useDataSources",
  "useDataValue",
  "useExecuteAction",
  "useFogMaskCache",
  "useLateTelemetrySubscribe",
  "useLatestValue",
  "useReplaySessionActive",
  "useStream",
  "useStreamEvent",
  "useTelemetry",
  "useTelemetryClientOptional",
  "useTelemetryStoreOptional",
  "useUtNow",
  "useViewClock",
  "useViewClockOptional",
].sort();

afterEach(() => {
  resetTestHost();
});

describe("sitrep-sdk author-facing barrel — shape gate", () => {
  it("exports exactly the recorded value surface (change = deliberate)", () => {
    // Type-only exports are erased at runtime, so Object.keys already yields
    // exactly the value surface.
    const actual = Object.keys(barrel).sort();
    expect(actual).toEqual(EXPECTED_BARREL_VALUE_EXPORTS);
  });

  it("every stateful shim fails LOUD when no host is installed", () => {
    resetTestHost();
    const named =
      /@ksp-gonogo\/sitrep-sdk: the gonogo host has not been installed/;
    expect(() =>
      barrel.registerComponent({
        id: "x",
        name: "X",
        description: "",
        tags: [],
        component: () => null,
      }),
    ).toThrow(named);
    expect(() => barrel.registerTheme({} as never)).toThrow(named);
    expect(() => barrel.registerAugment({} as never)).toThrow(named);
    expect(() => barrel.registerFogRevealSource({} as never)).toThrow(named);
    expect(() => barrel.registerMapPoiProvider({} as never)).toThrow(named);
    expect(() => barrel.useDataValue("kos", "k")).toThrow(named);
    expect(() => barrel.useTelemetry("vessel.orbit" as never)).toThrow(named);
    expect(() => barrel.createPerfBudget({ name: "b", threshold: 1 })).toThrow(
      named,
    );
    expect(() => barrel.logger.info("x")).toThrow(named);
  });

  it("hasHost reflects installation and never throws", () => {
    resetTestHost();
    expect(barrel.hasHost()).toBe(false);
    const dispose = installTestHost({});
    expect(barrel.hasHost()).toBe(true);
    dispose();
    expect(barrel.hasHost()).toBe(false);
  });

  it("resolves to the injected host when present (first-party parity)", () => {
    const registerComponent = vi.fn();
    const useDataValue = vi.fn().mockReturnValue(42);
    installTestHost({ registerComponent, useDataValue });

    const def = {
      id: "gauge",
      name: "Gauge",
      description: "",
      tags: [],
      component: () => null,
    };
    barrel.registerComponent(def);
    expect(registerComponent).toHaveBeenCalledWith(def);

    expect(barrel.useDataValue<number>("kos", "kos.compute.x")).toBe(42);
    expect(useDataValue).toHaveBeenCalledWith("kos", "kos.compute.x");
  });

  it("exposes the global key the app populates at boot", () => {
    expect(barrel.GONOGO_HOST_KEY).toBe("__GONOGO_SDK__");
  });
});
