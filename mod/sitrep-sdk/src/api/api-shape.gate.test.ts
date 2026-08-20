import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestHost, resetTestHost } from "../testing";
import * as barrel from "./index";

/**
 * The author-surface shape gate: the TS analogue of the C# ContractShapeGate,
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
  "DEFAULT_MASK_HEIGHT",
  "DEFAULT_MASK_WIDTH",
  "DEFAULT_PROFILE_ID",
  "FogMaskCache",
  "FogMaskCacheProvider",
  "FogMaskStore",
  "FogMaskStoreProvider",
  "MASK_SCHEMA_VERSION",
  "SettingsProvider",
  "SettingsService",
  "GAME_HOST_KEY",
  "GONOGO_HOST_KEY",
  "LocalStorageStore",
  // The augment registry's read/clear half, added deliberately: an Uplink reads
  // what it registered through the host, not through ui-kit's copy of the
  // registry (which a bundled client would own privately, so its augments would
  // silently never appear). See uplink-augment-route.test.ts.
  // Lets an Uplink tell "the game said no" from "the machinery broke" without
  // reaching into the unpublished spine for `CommandError`.
  "classifyCommandRejection",
  "clearAugments",
  "clearActionHandlers",
  "clearBodies",
  "clearFogRevealSources",
  "clearRegistry",
  "clearContributions",
  "clearMapPoiProviders",
  "clearUplinkHandles",
  "createPerfBudget",
  "defineUplinkClient",
  "dispatchAction",
  "getActiveTelemetryClient",
  "getBody",
  "getAllBodies",
  "getAugmentsForSlot",
  "getComponent",
  "getContributionsForSlot",
  "getDataSource",
  "getDataSources",
  "getFogRevealSourceSettings",
  "getFogRevealSources",
  "getGameHost",
  "getSetting",
  "getImagingWindow",
  "getMapPoiProviders",
  "getUplinkHandle",
  "hasHost",
  "imagingQuality",
  "logger",
  "onContributionsChange",
  "onFogRevealSourcesChange",
  "onMapPoiProvidersChange",
  "registerActionHandler",
  "registerAugment",
  "registerBody",
  "registerComponent",
  "registerDataSource",
  "registerFogRevealSource",
  "registerMapPoiProvider",
  "registerSetting",
  "registerSettingsTab",
  "registerStockBodies",
  "registerTheme",
  "resetSettingsForTests",
  "registerUplinkHandle",
  "safeRandomUuid",
  "seedSetting",
  "setSetting",
  "subscribeSetting",
  "unregisterActionHandler",
  "unregisterDataSource",
  "unregisterFogRevealSource",
  "unregisterUplinkHandle",
  "useActionInput",
  "useCommand",
  "useDataSources",
  "useBodyFogMask",
  "useFogMaskCache",
  "useFogMaskStore",
  "useLateTelemetrySubscribe",
  "useLatestValue",
  "useProcessor",
  "useReplaySessionActive",
  "useRouteCommands",
  "useSetting",
  "useSettingsService",
  "useStream",
  "useStreamEvent",
  "useTelemetry",
  "useTelemetryClientOptional",
  "useTelemetryStoreOptional",
  "useUtNow",
  "useViewClock",
  "useViewClockOptional",
  "useViewUt",
].sort();

afterEach(() => {
  resetTestHost();
});

describe("sitrep-sdk author-facing barrel: shape gate", () => {
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
    expect(() => barrel.registerAugment({} as never)).toThrow(named);
    expect(() => barrel.useTelemetry("vessel.orbit" as never)).toThrow(named);
    expect(() => barrel.registerSetting({} as never)).toThrow(named);
    expect(() => barrel.createPerfBudget({ name: "b", threshold: 1 })).toThrow(
      named,
    );
    expect(() => barrel.logger.info("x")).toThrow(named);
    expect(() =>
      barrel.defineUplinkClient({ id: "x", version: "0.0.0", name: "X" }),
    ).toThrow(named);
  });

  it("the OWNED registries work with no host at all", () => {
    // The counterpart to the test above, and it has to be here rather than only
    // in the per-registry test files: those import the registry module directly,
    // so they would still pass if the BARREL went back to resolving these
    // through the host. This asserts the barrel's own export is the real
    // function, which is the property that changed.
    resetTestHost();
    const provider = { id: "gate:pois", usePois: () => [] };
    expect(() => barrel.registerMapPoiProvider(provider)).not.toThrow();
    expect(barrel.getMapPoiProviders()).toEqual([provider]);
    barrel.clearMapPoiProviders();

    expect(() =>
      barrel.registerUplinkHandle("gate", { live: true }),
    ).not.toThrow();
    expect(barrel.getUplinkHandle("gate")).toEqual({ live: true });
    barrel.clearUplinkHandles();
    expect(barrel.getUplinkHandle("gate")).toBeUndefined();

    // The component registry, which is the one that matters most: a widget calls
    // `registerComponent` at MODULE LOAD, which can run before the app installs
    // its host, so needing one here would break registration outright. That is
    // also why the `REGISTERED` log is guarded by `hasHost` rather than fired
    // unconditionally.
    barrel.clearRegistry();
    const def = {
      id: "gate-gauge",
      name: "Gate Gauge",
      category: "test",
      component: () => null,
      dataRequirements: [],
      behaviors: [],
      defaultConfig: {},
    };
    expect(() => barrel.registerComponent(def)).not.toThrow();
    expect(barrel.getComponent("gate-gauge")).toBe(def);
    barrel.clearRegistry();
    expect(barrel.getComponent("gate-gauge")).toBeUndefined();

    // Fog reveal, whose settings read is the reason `NamespacedAugmentSettings`
    // had to come down from ui-kit: the type is the return of a registry read
    // that now lives in this package.
    barrel.clearFogRevealSources();
    const source = {
      id: "gate:coverage",
      settings: [{ key: "enabled", type: "boolean" as const }],
    };
    expect(() => barrel.registerFogRevealSource(source)).not.toThrow();
    expect(barrel.getFogRevealSources()).toEqual([source]);
    expect(barrel.getFogRevealSourceSettings()).toEqual([
      { augmentId: source.id, namespace: source.id, fields: source.settings },
    ]);
    barrel.clearFogRevealSources();
    expect(barrel.getFogRevealSources()).toEqual([]);
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
    const useTelemetry = vi.fn().mockReturnValue(42);
    installTestHost({ useTelemetry });

    expect(barrel.useTelemetry("kos.compute.x" as never)).toBe(42);
    // The shim forwards both args through in a single unconditional call
    // (see mod/sitrep-sdk/src/api/index.ts's useTelemetry doc) rather than
    // branching on `key` before calling the host, so a one-arg canonical
    // call still reaches the host as a two-arg call with `key` undefined.
    expect(useTelemetry).toHaveBeenCalledWith("kos.compute.x", undefined);
  });

  it("exposes the global key the app populates at boot", () => {
    expect(barrel.GONOGO_HOST_KEY).toBe("__GONOGO_SDK__");
  });
});
