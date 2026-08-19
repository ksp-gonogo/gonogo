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
    it("does not publish useDataSchema at all", () => {
      // Retired 2026-08-19 along with its host member, and asserted here rather
      // than simply deleted: it is the one SPI shim that could not follow the
      // others into this package, because the schema it returns for the default
      // `"data"` source is built from a legacy vendor key catalogue. Publishing
      // that would make a dying table into devkit API, where its removal becomes
      // an outside author's breaking change. No Uplink ever called it.
      expect(
        (barrel as Record<string, unknown>).useDataSchema,
        "useDataSchema is retired; @ksp-gonogo/data still exports it for the app",
      ).toBeUndefined();
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
    it("getGameHost reads the setting itself rather than forwarding to a host", () => {
      // Not a shim any more. It was one while the implementation lived in
      // `@ksp-gonogo/core`, and the only thing it needed was `getSetting`, which
      // this package has owned since the settings store moved. So the host member
      // retired with it: a two-line read of a setting this package holds does not
      // need injecting.
      resetTestHost();
      // The assertion that matters is that it does not throw with NO host, which
      // every shim in this file does. The value is the build default because this
      // suite runs in `node`: `localStorage` is undefined, so the store's own guard
      // makes the saved layer a no-op, as the comment below records for the settings
      // shims too.
      expect(barrel.getGameHost()).toBe("localhost");
    });

    // The settings STORE is not a shim any more: it moved into this package with
    // its service and its React context on 2026-08-19. `getGameHost` above still
    // is one, because the build-time default it falls back to is the app's.
    // This suite runs in `node`, where `localStorage` is undefined and the store's
    // own guard makes the SAVED layer a no-op. So these exercise the seed layer and
    // the subscriber fan-out, which are plain memory and mean the same thing in
    // either environment. The saved-beats-seed rule is `settings/store.test.ts`'s,
    // which runs under jsdom for exactly that reason.
    it("the settings store needs no host at all", () => {
      resetTestHost();
      barrel.resetSettingsForTests();
      const changed = vi.fn();
      const unsubscribe = barrel.subscribeSetting("gameHost", changed);

      barrel.seedSetting("gameHost", "seeded.local");
      expect(barrel.getSetting("gameHost")).toBe("seeded.local");
      expect(changed).toHaveBeenCalledTimes(1);

      unsubscribe();
      barrel.seedSetting("gameHost", "other.local");
      expect(changed).toHaveBeenCalledTimes(1);

      barrel.resetSettingsForTests();
      expect(barrel.getSetting("gameHost")).toBeUndefined();
    });

    it("notifies only the subscribers of the key that changed", () => {
      resetTestHost();
      barrel.resetSettingsForTests();
      const onHost = vi.fn();
      const onOther = vi.fn();
      barrel.subscribeSetting("gameHost", onHost);
      barrel.subscribeSetting("somethingElse", onOther);

      barrel.seedSetting("gameHost", "10.0.0.5");
      expect(onHost).toHaveBeenCalledTimes(1);
      expect(onOther).not.toHaveBeenCalled();
      barrel.resetSettingsForTests();
    });
  });

  describe("map/fog SPI", () => {
    // `getBody` was a shim, and its doc argued for this move without taking it: a
    // bundled copy of a module-static map would read its own permanently-empty
    // version. The map is a `globalThis` slot now, so there is no second copy to
    // read and no host to fail loud against.
    it("the body registry needs no host, and a pack overrides by re-registering", () => {
      resetTestHost();
      barrel.clearBodies();
      const kerbin = {
        id: "Kerbin",
        name: "Kerbin",
        radius: 600_000,
        hasAtmosphere: true,
        maxAtmosphere: 70_000,
      };
      barrel.registerBody(kerbin);
      expect(barrel.getBody("Kerbin")).toBe(kerbin);
      expect(barrel.getAllBodies()).toEqual([kerbin]);

      // Last write wins, which is the documented mechanism for a planet pack
      // overriding a stock entry rather than colliding with it. Unlike the
      // component registry, a duplicate id here is the intended usage.
      const rescaled = { ...kerbin, radius: 6_371_000 };
      barrel.registerBody(rescaled);
      expect(barrel.getBody("Kerbin")).toBe(rescaled);
      expect(barrel.getAllBodies()).toHaveLength(1);

      barrel.clearBodies();
      expect(barrel.getBody("Kerbin")).toBeUndefined();
    });

    it("registers the whole stock system, and threads the texture base URL", () => {
      resetTestHost();
      barrel.clearBodies();
      barrel.registerStockBodies("/gonogo/bodies");
      // The star plus every planet and moon: a count rather than a list, because
      // the point is that nothing silently dropped out of the data file.
      expect(barrel.getAllBodies().length).toBeGreaterThanOrEqual(16);
      expect(barrel.getBody("Kerbin")?.texture).toBe(
        "/gonogo/bodies/Kerbin_Color.png",
      );
      // Kerbol has no texture, so the base URL must not be applied blindly.
      expect(barrel.getBody("Sun")?.texture).toBeUndefined();
      barrel.clearBodies();
    });

    // Not a shim any more: the reveal-source registry moved into this package on
    // 2026-08-19, alongside the POI one and for the same reason. It went last of
    // the three because it was the one that needed a TYPE to move with it
    // (`NamespacedAugmentSettings`, down from ui-kit).
    it("the reveal-source registry needs no host, in either direction", () => {
      resetTestHost();
      barrel.clearFogRevealSources();
      const changed = vi.fn();
      const unsubscribe = barrel.onFogRevealSourcesChange(changed);

      const source = { id: "example-uplink:AltimetryHiRes", weight: 200 };
      barrel.registerFogRevealSource(source);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(barrel.getFogRevealSources()).toEqual([source]);

      barrel.unregisterFogRevealSource(source.id);
      expect(changed).toHaveBeenCalledTimes(2);
      expect(barrel.getFogRevealSources()).toEqual([]);

      unsubscribe();
      barrel.clearFogRevealSources();
      // Unsubscribed before the clear, so the count has not moved again.
      expect(changed).toHaveBeenCalledTimes(2);
    });

    it("namespaces each source's settings by its own id", () => {
      resetTestHost();
      barrel.clearFogRevealSources();
      // A source with no settings contributes no block at all, so the panel does
      // not render an empty section for it.
      barrel.registerFogRevealSource({ id: "a:plain" });
      barrel.registerFogRevealSource({
        id: "b:tunable",
        settings: [{ key: "enabled", type: "boolean", default: true }],
      });
      expect(barrel.getFogRevealSourceSettings()).toEqual([
        {
          augmentId: "b:tunable",
          namespace: "b:tunable",
          fields: [{ key: "enabled", type: "boolean", default: true }],
        },
      ]);
      barrel.clearFogRevealSources();
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

    // `useFogMaskCache` used to be checked here, as a shim that failed loud with
    // no host. It is the real hook now (the context moved into this package), so
    // it needs a render to exercise and lives in `fog/FogMaskContext.test.tsx`,
    // which sets its own jsdom environment. Converting this file would have
    // changed the environment for forty node-environment assertions to gain one.
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
