import { clearRegistry, getMapPoiProviders } from "@ksp-gonogo/core";
import { act, renderHook } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./vanillaPoiProvider";

/**
 * What `undefined` means inside the vanilla POI provider, the one MapView
 * site forwarding a three-state answer: `undefined` for not arrived, `[]` for
 * arrived with nothing here. MapPoiLayer renders both as nothing, so this reads
 * the hook's return value.
 */

function getProvider() {
  const provider = getMapPoiProviders().find(
    (p) => p.id === "vanilla:spaceCenter",
  );
  if (!provider) throw new Error("vanilla:spaceCenter provider not registered");
  return provider;
}

// Unmount before clearRegistry() notifies subscribers, which would be a state update outside act(). The provider registers itself once, so the MapPoi registry is not cleared.
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearRegistry();
});

function renderPois(bodyId: string | undefined) {
  const fixture = setupStreamFixture({ suspendFrames: true });
  const provider = getProvider();
  const { result, unmount } = renderHook(() => provider.usePois({ bodyId }), {
    wrapper: fixture.Provider,
  });
  renderedTrees.push(unmount);
  return { result, fixture };
}

async function flushFrames(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

describe("vanillaPoiProvider: what undefined telemetry means today", () => {
  it("nothing emitted: undefined is forwarded as undefined, the provider's own PENDING signal", async () => {
    const { result } = renderPois("Kerbin");
    await flushFrames();

    // The one absence distinction this file makes.
    expect(result.current).toBeUndefined();
  });

  it("nothing emitted AND no mapped body: still undefined, because the raw gate is checked before the body gate's fallback", async () => {
    const { result } = renderPois(undefined);
    await flushFrames();

    // The gate's return consults only `raw`, so an absent body cannot produce `[]` while the topic is pending.
    expect(result.current).toBeUndefined();
  });

  it("POIs arrived but the mapped body is undefined: reads as EMPTY, not as pending", async () => {
    const { result, fixture } = renderPois(undefined);
    act(() => {
      fixture.emit("system.bodies", { bodies: [{ index: 1, name: "Kerbin" }] });
      fixture.emit("spaceCenter.pois", [
        {
          id: "launchSite:Runway",
          kind: "ksc",
          bodyIndex: 1,
          latitude: -0.05,
          longitude: -74.7,
          label: "Runway",
        },
      ]);
    });
    await flushFrames();

    // No body chosen reads as "no POIs on this body".
    expect(result.current).toEqual([]);
  });

  it("POIs arrived but system.bodies never did: every POI is SILENTLY dropped, reported as an empty body", async () => {
    const { result, fixture } = renderPois("Kerbin");
    act(() => {
      fixture.emit("spaceCenter.pois", [
        {
          id: "launchSite:Runway",
          kind: "ksc",
          bodyIndex: 1,
          latitude: -0.05,
          longitude: -74.7,
          label: "Runway",
        },
      ]);
    });
    await flushFrames();

    // An absent body table gives an empty index-to-name map, so one topic's pending state reads as a confirmed fact about another.
    expect(result.current).toEqual([]);
  });

  it("a system.bodies entry with no name is dropped from the index, taking its POIs with it", async () => {
    const { result, fixture } = renderPois("Kerbin");
    act(() => {
      // Body 1 arrived without a name, so its POI can never match a bodyId.
      fixture.emit("system.bodies", {
        bodies: [{ index: 1 }, { index: 2, name: "Mun" }],
      });
      fixture.emit("spaceCenter.pois", [
        {
          id: "launchSite:Runway",
          kind: "ksc",
          bodyIndex: 1,
          latitude: -0.05,
          longitude: -74.7,
          label: "Runway",
        },
      ]);
    });
    await flushFrames();

    expect(result.current).toEqual([]);
  });

  it("a TOMBSTONED spaceCenter.pois reads as EMPTY, not pending: null and undefined mean different things here", async () => {
    const { result, fixture } = renderPois("Kerbin");
    await flushFrames();
    expect(result.current).toBeUndefined();

    act(() => {
      // A confirmed tombstone.
      fixture.emit("spaceCenter.pois", null);
    });
    await flushFrames();

    // The tombstone takes the `[]` branch: a confirmed absence is a load that found nothing.
    expect(result.current).toEqual([]);
  });

  it("a POI entry missing any required field vanishes entirely rather than rendering partially", async () => {
    const { result, fixture } = renderPois("Kerbin");
    act(() => {
      fixture.emit("system.bodies", { bodies: [{ index: 1, name: "Kerbin" }] });
      fixture.emit("spaceCenter.pois", [
        {
          id: "complete",
          kind: "ksc",
          bodyIndex: 1,
          latitude: -0.05,
          longitude: -74.7,
          label: "Runway",
        },
        // Each trips one clause of `toMapPoi`'s `== null` gate; a partial POI is indistinguishable from one never sent.
        {
          id: "no-label",
          kind: "ksc",
          bodyIndex: 1,
          latitude: 0,
          longitude: 0,
        },
        {
          id: "no-latitude",
          kind: "ksc",
          bodyIndex: 1,
          longitude: 0,
          label: "A",
        },
        {
          id: "no-longitude",
          kind: "ksc",
          bodyIndex: 1,
          latitude: 0,
          label: "B",
        },
        { id: "no-kind", bodyIndex: 1, latitude: 0, longitude: 0, label: "C" },
        {
          kind: "ksc",
          bodyIndex: 1,
          latitude: 0,
          longitude: 0,
          label: "no id",
        },
      ]);
    });
    await flushFrames();

    expect(result.current?.map((poi) => poi.id)).toEqual(["complete"]);
  });

  it("a POI entry with no bodyIndex is dropped by the body filter, before toMapPoi ever sees it", async () => {
    const { result, fixture } = renderPois("Kerbin");
    act(() => {
      fixture.emit("system.bodies", { bodies: [{ index: 1, name: "Kerbin" }] });
      fixture.emit("spaceCenter.pois", [
        {
          id: "no-bodyIndex",
          kind: "ksc",
          latitude: 0,
          longitude: 0,
          label: "Orphan",
        },
      ]);
    });
    await flushFrames();

    // An unplaceable POI reads as "not on this body" rather than an error.
    expect(result.current).toEqual([]);
  });

  it("a contractTarget with no funds/agent fields still becomes a POI, carrying undefined meta values", async () => {
    const { result, fixture } = renderPois("Kerbin");
    act(() => {
      fixture.emit("system.bodies", { bodies: [{ index: 1, name: "Kerbin" }] });
      fixture.emit("spaceCenter.pois", [
        {
          id: "contract:bare",
          kind: "contractTarget",
          bodyIndex: 1,
          latitude: 5,
          longitude: 100,
          label: "Recover the flag",
        },
      ]);
    });
    await flushFrames();

    // The gate covers only positional and identity fields, so a contract with no economics is a marker whose hover card shows no terms.
    expect(result.current).toHaveLength(1);
    expect(result.current?.[0].meta).toEqual({
      agent: undefined,
      fundsAdvance: undefined,
      fundsCompletion: undefined,
      deadline: undefined,
    });
  });
});
