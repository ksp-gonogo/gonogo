import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestHost, resetTestHost } from "../testing";
import * as barrel from "./index";

afterEach(() => {
  resetTestHost();
});

describe("sitrep-sdk author-facing barrel: shims without a host", () => {
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
      barrel.defineUplinkClient({
        id: "x",
        version: "0.0.0",
        name: "X",
        description: "Test",
      }),
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

    expect(() => barrel.registerStationBroker("gate", () => {})).not.toThrow();
    barrel.clearStationBrokers();

    // The component registry, which is the one that matters most: a widget calls
    // `registerComponent` at MODULE LOAD, which can run before the app installs
    // its host, so needing one here would break registration outright. That is
    // also why the `REGISTERED` log is guarded by `hasHost` rather than fired
    // unconditionally.
    barrel.clearRegistry();
    const def = {
      id: "gate-gauge",
      name: "Gate Gauge",
      description: "A gauge that exists to be registered.",
      tags: ["test"],
      component: () => null,
      dataRequirements: [],
      behaviors: [],
      defaultConfig: {},
    };
    expect(() => barrel.registerComponent(def)).not.toThrow();
    expect(barrel.getComponent("gate-gauge")).toBe(def);
    barrel.clearRegistry();
    expect(barrel.getComponent("gate-gauge")).toBeUndefined();

    // The coverage-source registry, whose settings read is the reason `NamespacedAugmentSettings`
    // had to come down from ui-kit: the type is the return of a registry read
    // that now lives in this package.
    barrel.clearCoverageSources();
    const source = {
      id: "gate:coverage",
      settings: [{ key: "enabled", type: "boolean" as const }],
    };
    expect(() => barrel.registerCoverageSource(source)).not.toThrow();
    expect(barrel.getCoverageSources()).toEqual([source]);
    expect(barrel.getCoverageSourceSettings()).toEqual([
      { augmentId: source.id, namespace: source.id, fields: source.settings },
    ]);
    barrel.clearCoverageSources();
    expect(barrel.getCoverageSources()).toEqual([]);
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
    expect(useTelemetry).toHaveBeenCalledWith("kos.compute.x");
  });

  it("exposes the global key the app populates at boot", () => {
    expect(barrel.GONOGO_HOST_KEY).toBe("__GONOGO_SDK__");
  });
});
