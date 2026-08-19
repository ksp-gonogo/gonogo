import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestHost, resetTestHost } from "../testing";
import * as barrel from "./index";

/**
 * Phase 0.4 additions: stream SPI, data introspection, the game-host SPI,
 * the map/fog SPI, the Uplink-handle SPI, the settings-tab SPI, and the
 * telemetry-client SPI. Same injected-host contract as every other stateful
 * member (design §4.3 / D-A): fail loud with no host installed, resolve to
 * the injected host's own implementation once one is.
 *
 * The DataSource-author SPI (registerDataSource/getDataSource) that used to
 * have its own describe block here went through a removal (2026-07-18, "zero
 * production consumers"), a same-night reversal once two facade-sealed
 * Uplink clients turned out to still need it (facade-sealing plan §2.1), and
 * a final removal (2026-07-19) once both were migrated onto non-SPI
 * substitutes: see mod/sitrep-sdk/src/api/types.ts's DataSource type-mirror
 * comment for the full history. Any Uplink authoring a `DataSource` goes
 * through the barrel like everything else; there is nothing left on this
 * facade to gate.
 */
describe("sitrep-sdk author-facing barrel: SPI gap shims", () => {
  afterEach(() => {
    resetTestHost();
  });

  const named =
    /@ksp-gonogo\/sitrep-sdk: the gonogo host has not been installed/;

  describe("stream SPI", () => {
    it("useLatestValue fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useLatestValue("comms.delay")).toThrow(named);

      const useLatestValue = vi.fn().mockReturnValue(42);
      installTestHost({ useLatestValue });
      expect(barrel.useLatestValue<number>("comms.delay")).toBe(42);
      expect(useLatestValue).toHaveBeenCalledWith("comms.delay");
    });

    it("useStreamEvent fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      const handler = vi.fn();
      expect(() => barrel.useStreamEvent("crash.lastCrash", handler)).toThrow(
        named,
      );

      const useStreamEvent = vi.fn();
      installTestHost({ useStreamEvent });
      barrel.useStreamEvent("crash.lastCrash", handler);
      expect(useStreamEvent).toHaveBeenCalledWith("crash.lastCrash", handler);
    });

    it("useUtNow fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useUtNow()).toThrow(named);

      const useUtNow = vi.fn().mockReturnValue(123.5);
      installTestHost({ useUtNow });
      expect(barrel.useUtNow()).toBe(123.5);
    });

    it("useTelemetryStoreOptional fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useTelemetryStoreOptional()).toThrow(named);

      const fakeStore = { currentFrame: vi.fn() };
      const useTelemetryStoreOptional = vi.fn().mockReturnValue(fakeStore);
      installTestHost({ useTelemetryStoreOptional });
      expect(barrel.useTelemetryStoreOptional()).toBe(fakeStore);
    });

    it("useViewClockOptional fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useViewClockOptional()).toThrow(named);

      const fakeClock = { confirmedEdgeUt: vi.fn() };
      const useViewClockOptional = vi.fn().mockReturnValue(fakeClock);
      installTestHost({ useViewClockOptional });
      expect(barrel.useViewClockOptional()).toBe(fakeClock);
    });
  });

  describe("data introspection", () => {
    it("useDataSchema fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useDataSchema("kos")).toThrow(named);

      const schema = [{ key: "widget.example.value", label: "X" }];
      const useDataSchema = vi.fn().mockReturnValue(schema);
      installTestHost({ useDataSchema });
      expect(barrel.useDataSchema("kos")).toBe(schema);
      expect(useDataSchema).toHaveBeenCalledWith("kos");
    });

    it("useReplaySessionActive fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useReplaySessionActive()).toThrow(named);

      const useReplaySessionActive = vi.fn().mockReturnValue(true);
      installTestHost({ useReplaySessionActive });
      expect(barrel.useReplaySessionActive()).toBe(true);
    });
  });

  describe("game-host SPI", () => {
    it("getGameHost fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.getGameHost()).toThrow(named);

      const getGameHost = vi.fn().mockReturnValue("192.168.1.50");
      installTestHost({ getGameHost });
      expect(barrel.getGameHost()).toBe("192.168.1.50");
    });

    it("subscribeSetting fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      const cb = vi.fn();
      expect(() => barrel.subscribeSetting("gameHost", cb)).toThrow(named);

      const unsubscribe = vi.fn();
      const subscribeSetting = vi.fn().mockReturnValue(unsubscribe);
      installTestHost({ subscribeSetting });
      expect(barrel.subscribeSetting("gameHost", cb)).toBe(unsubscribe);
      expect(subscribeSetting).toHaveBeenCalledWith("gameHost", cb);
    });
  });

  describe("map/fog SPI", () => {
    it("getBody fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.getBody("Kerbin")).toThrow(named);

      const fakeBody = { id: "Kerbin" } as never;
      const getBody = vi.fn().mockReturnValue(fakeBody);
      installTestHost({ getBody });
      expect(barrel.getBody("Kerbin")).toBe(fakeBody);
      expect(getBody).toHaveBeenCalledWith("Kerbin");
    });

    it("getFogRevealSources fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.getFogRevealSources()).toThrow(named);

      const sources = [{ id: "example-uplink:AltimetryHiRes" }] as never;
      const getFogRevealSources = vi.fn().mockReturnValue(sources);
      installTestHost({ getFogRevealSources });
      expect(barrel.getFogRevealSources()).toBe(sources);
    });

    it("setSetting fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => {
        barrel.setSetting("gameHost", "10.0.0.5");
      }).toThrow(named);

      const setSetting = vi.fn();
      installTestHost({ setSetting });
      barrel.setSetting("gameHost", "10.0.0.5");
      expect(setSetting).toHaveBeenCalledWith("gameHost", "10.0.0.5");
    });

    it("getContributionsForSlot fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() =>
        barrel.getContributionsForSlot("ship-map.part-meters"),
      ).toThrow(named);

      const contributions = [{ id: "example-uplink:coolant" }] as never;
      const getContributionsForSlot = vi.fn().mockReturnValue(contributions);
      installTestHost({ getContributionsForSlot });
      expect(barrel.getContributionsForSlot("ship-map.part-meters")).toBe(
        contributions,
      );
      expect(getContributionsForSlot).toHaveBeenCalledWith(
        "ship-map.part-meters",
      );
    });

    it("onContributionsChange fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      const cb = vi.fn();
      expect(() => barrel.onContributionsChange(cb)).toThrow(named);

      const unsubscribe = vi.fn();
      const onContributionsChange = vi.fn().mockReturnValue(unsubscribe);
      installTestHost({ onContributionsChange });
      expect(barrel.onContributionsChange(cb)).toBe(unsubscribe);
      expect(onContributionsChange).toHaveBeenCalledWith(cb);
    });

    it("clearContributions fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => {
        barrel.clearContributions();
      }).toThrow(named);

      const clearContributions = vi.fn();
      installTestHost({ clearContributions });
      barrel.clearContributions();
      expect(clearContributions).toHaveBeenCalledTimes(1);
    });

    // The POI provider registry is NOT a shim any more: it moved into this
    // package on 2026-08-19, so there is no host to fail loud against. These
    // three used to assert the throw; asserting the OPPOSITE is what keeps the
    // move honest, because a silent regression to the host path would otherwise
    // look identical to a passing suite.
    it("the POI provider registry needs no host, in either direction", () => {
      resetTestHost();
      const changed = vi.fn();
      const unsubscribe = barrel.onMapPoiProvidersChange(changed);

      const provider = { id: "example-uplink:anomalies", usePois: () => [] };
      barrel.registerMapPoiProvider(provider);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(barrel.getMapPoiProviders()).toEqual([provider]);

      unsubscribe();
      barrel.clearMapPoiProviders();
      expect(barrel.getMapPoiProviders()).toEqual([]);
      // Unsubscribed before the clear, so the count has not moved.
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it("keeps POI providers in registration order, not insertion-lucky order", () => {
      resetTestHost();
      barrel.clearMapPoiProviders();
      const first = { id: "b:second-alphabetically", usePois: () => [] };
      const second = { id: "a:first-alphabetically", usePois: () => [] };
      barrel.registerMapPoiProvider(first);
      barrel.registerMapPoiProvider(second);
      expect(barrel.getMapPoiProviders().map((p) => p.id)).toEqual([
        first.id,
        second.id,
      ]);
      barrel.clearMapPoiProviders();
    });

    it("onFogRevealSourcesChange fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      const cb = vi.fn();
      expect(() => barrel.onFogRevealSourcesChange(cb)).toThrow(named);

      const unsubscribe = vi.fn();
      const onFogRevealSourcesChange = vi.fn().mockReturnValue(unsubscribe);
      installTestHost({ onFogRevealSourcesChange });
      expect(barrel.onFogRevealSourcesChange(cb)).toBe(unsubscribe);
      expect(onFogRevealSourcesChange).toHaveBeenCalledWith(cb);
    });

    it("useFogMaskCache fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useFogMaskCache()).toThrow(named);

      const fakeCache = { acquire: vi.fn() } as never;
      const useFogMaskCache = vi.fn().mockReturnValue(fakeCache);
      installTestHost({ useFogMaskCache });
      expect(barrel.useFogMaskCache()).toBe(fakeCache);
    });
  });

  // Also no longer a shim: the handle registry moved into this package with the
  // POI one, for the same reason (it named nothing above this leaf) and to close
  // the same gap (an Uplink could write to it and had no published read).
  describe("Uplink-handle registry, which needs no host", () => {
    it("round-trips a handle and hands back the same object", () => {
      resetTestHost();
      const handle = { foo: "bar" };
      barrel.registerUplinkHandle("example-uplink", handle);
      // `toBe`, not `toEqual`: a handle is a SINGLETON, and a registry that
      // cloned it would satisfy structural equality while breaking every caller
      // that relies on identity (a live WebRTC client, a relay object).
      expect(barrel.getUplinkHandle("example-uplink")).toBe(handle);
      barrel.clearUplinkHandles();
    });

    it("last write wins, and unregister removes just the one id", () => {
      resetTestHost();
      barrel.clearUplinkHandles();
      barrel.registerUplinkHandle("a", { v: 1 });
      barrel.registerUplinkHandle("a", { v: 2 });
      barrel.registerUplinkHandle("b", { v: 3 });
      expect(barrel.getUplinkHandle("a")).toEqual({ v: 2 });

      barrel.unregisterUplinkHandle("a");
      expect(barrel.getUplinkHandle("a")).toBeUndefined();
      expect(barrel.getUplinkHandle("b")).toEqual({ v: 3 });
      barrel.clearUplinkHandles();
    });
  });

  describe("settings-tab SPI", () => {
    it("registerSettingsTab fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      const def = {
        id: "example-uplink",
        label: "Example Uplink",
        component: () => null,
      };
      expect(() => barrel.registerSettingsTab(def)).toThrow(named);

      const registerSettingsTab = vi.fn();
      installTestHost({ registerSettingsTab });
      barrel.registerSettingsTab(def);
      expect(registerSettingsTab).toHaveBeenCalledWith(def);
    });
  });

  describe("telemetry-client SPI", () => {
    it("getActiveTelemetryClient fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.getActiveTelemetryClient()).toThrow(named);

      const fakeClient = { subscribe: vi.fn() } as never;
      const getActiveTelemetryClient = vi.fn().mockReturnValue(fakeClient);
      installTestHost({ getActiveTelemetryClient });
      expect(barrel.getActiveTelemetryClient()).toBe(fakeClient);
    });

    it("useTelemetryClientOptional fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useTelemetryClientOptional()).toThrow(named);

      const fakeClient = { subscribe: vi.fn() } as never;
      const useTelemetryClientOptional = vi.fn().mockReturnValue(fakeClient);
      installTestHost({ useTelemetryClientOptional });
      expect(barrel.useTelemetryClientOptional()).toBe(fakeClient);
    });
  });

  it("GAME_HOST_KEY is the stable settings key, never gated by the host", () => {
    expect(barrel.GAME_HOST_KEY).toBe("gameHost");
  });

  it("safeRandomUuid is a stateless util, no host needed, produces distinct v4 UUIDs", () => {
    resetTestHost();
    const a = barrel.safeRandomUuid();
    const b = barrel.safeRandomUuid();
    const v4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(a).toMatch(v4);
    expect(b).toMatch(v4);
    expect(a).not.toBe(b);
  });

  describe("LocalStorageStore: stateless class, no host needed on the happy path", () => {
    function fakeStorage(): Storage {
      const store = new Map<string, string>();
      return {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => store.clear(),
        key: () => null,
        get length() {
          return store.size;
        },
      } as Storage;
    }

    it("get/set/patch/clear round-trip with an injected Storage, no host dependency", () => {
      resetTestHost();
      const store = new barrel.LocalStorageStore({
        key: "test.widget",
        defaults: { enabled: true, count: 0 },
        storage: fakeStorage(),
      });
      expect(store.get()).toEqual({ enabled: true, count: 0 });
      store.set({ enabled: false, count: 3 });
      expect(store.get()).toEqual({ enabled: false, count: 3 });
      store.patch({ count: 5 });
      expect(store.get()).toEqual({ enabled: false, count: 5 });
      store.clear();
      expect(store.get()).toEqual({ enabled: true, count: 0 });
    });

    it("the DEFAULT corruption logger only touches the host when corruption is actually hit", () => {
      resetTestHost();
      const storage = fakeStorage();
      storage.setItem("test.widget", "{not json");
      const store = new barrel.LocalStorageStore({
        key: "test.widget",
        defaults: { enabled: true },
        storage,
      });
      // Fails loud rather than silently logging to a dead console-only
      // logger: same reasoning as the `logger` Proxy shim in ./index.ts.
      expect(() => store.get()).toThrow(named);

      const warn = vi.fn();
      installTestHost({ logger: { tag: () => ({ warn }) } as never });
      expect(store.get()).toEqual({ enabled: true });
      expect(warn).toHaveBeenCalled();
    });
  });
});
