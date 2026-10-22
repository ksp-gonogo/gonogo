import { clearRegistry, getMapPoiProviders } from "@ksp-gonogo/core";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./flagPoiProvider";

function getProvider() {
  const provider = getMapPoiProviders().find((p) => p.id === "vanilla:flags");
  if (!provider) throw new Error("vanilla:flags provider not registered");
  return provider;
}

// Unmounted before clearRegistry() notifies subscribers, which would be a state update outside act().
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearRegistry();
});

function mount(bodyId: string) {
  const fixture = setupStreamFixture({ suspendFrames: true });
  const provider = getProvider();
  const { result, unmount } = renderHook(() => provider.usePois({ bodyId }), {
    wrapper: fixture.Provider,
  });
  renderedTrees.push(unmount);
  return { fixture, result };
}

describe("flagPoiProvider: planted flags as map points", () => {
  it("has no points before surface.sites has arrived and none once it says no flag is planted", async () => {
    const { fixture, result } = mount("Mun");
    expect(result.current).toBeUndefined();

    act(() => {
      fixture.emit("surface.sites", []);
    });

    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("marks a flag at its place under the name the kerbal gave the site", async () => {
    const { fixture, result } = mount("Mun");

    act(() => {
      fixture.emit("surface.sites", [
        {
          siteId: "flag-1",
          name: "Midlands Outpost",
          body: "Mun",
          latitude: 1.5,
          longitude: -20.25,
          plantedAt: 88100,
          plantedBy: "Maxwell Kerman",
          plaque: "First on the Mun",
        },
      ]);
    });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current?.[0]).toMatchObject({
      id: "flag:flag-1",
      bodyId: "Mun",
      kind: "flag",
      label: "Midlands Outpost",
      lat: 1.5,
      lon: -20.25,
      detail: "Planted by Maxwell Kerman",
      meta: { plaque: "First on the Mun" },
    });
    expect(result.current?.[0]?.meta?.planted).toBeDefined();
  });

  it("leaves out a flag on another body and one whose place is unread", async () => {
    const { fixture, result } = mount("Mun");

    act(() => {
      fixture.emit("surface.sites", [
        {
          siteId: "a",
          name: "Minmus Flat",
          body: "Minmus",
          latitude: 0,
          longitude: 0,
        },
        {
          siteId: "b",
          name: "Unplaced",
          body: "Mun",
          latitude: null,
          longitude: null,
        },
        {
          siteId: "c",
          name: "Mun Flag",
          body: "Mun",
          latitude: 2,
          longitude: 3,
        },
      ]);
    });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current?.[0]?.label).toBe("Mun Flag");
  });
});
