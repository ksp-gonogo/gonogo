import {
  clearRegistry,
  getMapPoiProviders,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
// Importing the real module (not a throwaway test double) runs its
// module-load `registerMapPoiProvider(...)` exactly once — same convention
// as the deleted slot.test.tsx's `registerAugment` import.
import "./index";

function getProvider() {
  const provider = getMapPoiProviders().find(
    (p) => p.id === "scansat:anomalies",
  );
  if (!provider) {
    throw new Error("scansat:anomalies provider not registered");
  }
  return provider;
}

function wrapper(client: TelemetryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <TelemetryProvider client={client}>{children}</TelemetryProvider>;
  };
}

afterEach(() => clearRegistry());

describe("scansat:anomalies map POI provider", () => {
  it("is registered gated on the scansat domain", () => {
    expect(getProvider().requires).toBe("scansat");
  });

  it("maps known anomalies to MapPois, excluding undiscovered ones", async () => {
    const anomalySource = new MockDataSource({ id: "data" });
    registerDataSource(anomalySource);
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const provider = getProvider();

    const { result } = renderHook(
      () => provider.usePois({ bodyId: "Kerbin" }),
      { wrapper: wrapper(client) },
    );

    act(() => {
      anomalySource.emit("scansat.anomalies.Kerbin", [
        {
          name: "Monolith",
          latitude: 10,
          longitude: 33,
          known: true,
          detail: true,
        },
        {
          name: "Pyramid",
          latitude: -5,
          longitude: 12,
          known: true,
          detail: false,
        },
        {
          name: "Hidden",
          latitude: 0,
          longitude: 0,
          known: false,
          detail: false,
        },
      ]);
    });

    await waitFor(() => expect(result.current).toHaveLength(2));

    const monolith = result.current?.find((p) =>
      p.id.startsWith("anomaly:Monolith"),
    );
    expect(monolith).toMatchObject({
      bodyId: "Kerbin",
      lat: 10,
      lon: 33,
      kind: "anomaly",
      label: "Monolith",
      status: "info",
      meta: { known: true, detail: true },
    });

    // detail=false → label falls back to "(unknown)", matching the
    // old AnomalyOverlay's undiscovered-detail display convention.
    const pyramid = result.current?.find((p) =>
      p.id.startsWith("anomaly:Pyramid"),
    );
    expect(pyramid).toMatchObject({ label: "(unknown)" });
  });

  it("a POI's set-target action dispatches tar.setTargetPosition with the resolved body index", async () => {
    const anomalySource = new MockDataSource({ id: "data" });
    let capturedAction: string | undefined;
    anomalySource.execute = async (action: string) => {
      capturedAction = action;
    };
    registerDataSource(anomalySource);
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const provider = getProvider();

    const { result } = renderHook(
      () => provider.usePois({ bodyId: "Kerbin" }),
      { wrapper: wrapper(client) },
    );

    act(() => {
      client.subscribe("system.bodies", () => {});
    });
    await act(async () => {
      transport.emit("system.bodies", {
        bodies: [
          { index: 1, name: "Kerbin" },
          { index: 2, name: "Mun" },
        ],
      });
      anomalySource.emit("scansat.anomalies.Kerbin", [
        {
          name: "Monolith",
          latitude: 10,
          longitude: 33,
          known: true,
          detail: true,
        },
      ]);
      await Promise.resolve();
    });

    // Wait specifically for the action to appear — a bare length-1 check on
    // `result.current` would already be satisfied by the anomaly landing
    // before `system.bodies` resolves (actions start empty until the body
    // index is known), which would grab a stale snapshot.
    await waitFor(() => expect(result.current?.[0]?.actions).toHaveLength(1));

    const poi = result.current?.[0];
    expect(poi?.actions?.[0].id).toBe("set-target");

    await act(async () => {
      await poi?.actions?.[0].run();
    });

    expect(capturedAction).toBe("tar.setTargetPosition[1,10,33]");
  });

  it("returns [] (no actions dispatched) once loaded with no anomalies for the body", async () => {
    const anomalySource = new MockDataSource({ id: "data" });
    registerDataSource(anomalySource);
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const provider = getProvider();

    const { result } = renderHook(
      () => provider.usePois({ bodyId: "Kerbin" }),
      { wrapper: wrapper(client) },
    );

    act(() => {
      anomalySource.emit("scansat.anomalies.Kerbin", []);
    });

    await waitFor(() => expect(result.current).toEqual([]));
  });
});
