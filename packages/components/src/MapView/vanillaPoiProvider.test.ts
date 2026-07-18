import {
  clearRegistry,
  getMapPoiProviders,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./vanillaPoiProvider";

function getProvider() {
  const provider = getMapPoiProviders().find(
    (p) => p.id === "vanilla:spaceCenter",
  );
  if (!provider) throw new Error("vanilla:spaceCenter provider not registered");
  return provider;
}

afterEach(() => clearRegistry());

describe("vanillaPoiProvider — KSC/launch-site/contract-target POIs", () => {
  it("is registered with no `requires` gate — core Sitrep data, always potentially present", () => {
    expect(getProvider().requires).toBeUndefined();
  });

  it("returns undefined before spaceCenter.pois has arrived, [] once loaded with no matching body", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["spaceCenter.pois", "system.bodies"],
    });
    const provider = getProvider();

    const { result } = renderHook(
      () => provider.usePois({ bodyId: "Kerbin" }),
      {
        wrapper: fixture.Provider,
      },
    );

    expect(result.current).toBeUndefined();

    act(() => {
      fixture.emit("spaceCenter.pois", []);
    });

    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("filters POIs to the current body and carries contractTarget meta (funds/agent/deadline)", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["spaceCenter.pois", "system.bodies"],
    });
    const provider = getProvider();

    const { result } = renderHook(
      () => provider.usePois({ bodyId: "Kerbin" }),
      {
        wrapper: fixture.Provider,
      },
    );

    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          { index: 1, name: "Kerbin" },
          { index: 2, name: "Mun" },
        ],
      });
      fixture.emit("spaceCenter.pois", [
        {
          id: "launchSite:Runway",
          kind: "ksc",
          bodyIndex: 1,
          latitude: -0.0486,
          longitude: -74.72,
          label: "Runway",
        },
        {
          id: "contract:abc123",
          kind: "contractTarget",
          bodyIndex: 1,
          latitude: 5.2,
          longitude: 100.4,
          label: "Recover the flag",
          status: "active",
          contractAgent: "Kerbin Space Agency",
          contractFundsAdvance: 1000,
          contractFundsCompletion: 5000,
          contractDateDeadline: 12345,
        },
        // Different body — must be filtered out of the Kerbin-scoped result.
        {
          id: "launchSite:Woomerang",
          kind: "launchSite",
          bodyIndex: 2,
          latitude: 10,
          longitude: 20,
          label: "Woomerang Launch Site",
        },
      ]);
    });

    await waitFor(() => expect(result.current).toHaveLength(2));

    const ids = result.current?.map((p) => p.id);
    expect(ids).toEqual(["launchSite:Runway", "contract:abc123"]);

    const ksc = result.current?.find((p) => p.id === "launchSite:Runway");
    expect(ksc).toMatchObject({
      bodyId: "Kerbin",
      lat: -0.0486,
      lon: -74.72,
      kind: "ksc",
      label: "Runway",
      status: "info",
      meta: undefined,
    });

    const contract = result.current?.find((p) => p.id === "contract:abc123");
    expect(contract).toMatchObject({
      bodyId: "Kerbin",
      lat: 5.2,
      lon: 100.4,
      kind: "contractTarget",
      label: "Recover the flag",
      status: "active",
      meta: {
        agent: "Kerbin Space Agency",
        fundsAdvance: 1000,
        fundsCompletion: 5000,
        deadline: 12345,
      },
    });
  });

  it("a POI's set-target action dispatches tar.setTargetPosition with its own bodyIndex/lat/lon", async () => {
    const executeSpy = new MockDataSource({ id: "data" });
    let capturedAction: string | undefined;
    executeSpy.execute = async (action: string) => {
      capturedAction = action;
    };
    registerDataSource(executeSpy);

    const fixture = setupStreamFixture({
      carriedChannels: ["spaceCenter.pois", "system.bodies"],
    });
    const provider = getProvider();

    const { result } = renderHook(
      () => provider.usePois({ bodyId: "Kerbin" }),
      {
        wrapper: fixture.Provider,
      },
    );

    act(() => {
      fixture.emit("system.bodies", { bodies: [{ index: 1, name: "Kerbin" }] });
      fixture.emit("spaceCenter.pois", [
        {
          id: "launchSite:Runway",
          kind: "ksc",
          bodyIndex: 1,
          latitude: -0.0486,
          longitude: -74.72,
          label: "Runway",
        },
      ]);
    });

    await waitFor(() => expect(result.current).toHaveLength(1));

    const poi = result.current?.[0];
    expect(poi?.actions).toHaveLength(1);
    expect(poi?.actions?.[0].id).toBe("set-target");

    await act(async () => {
      await poi?.actions?.[0].run();
    });

    expect(capturedAction).toBe("tar.setTargetPosition[1,-0.0486,-74.72]");
  });
});
