import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { useTrackedVesselTopology } from "./useTrackedVesselTopology";

function TopologyProbe({ guid }: { guid: string }) {
  const tracked = useTrackedVesselTopology(guid);
  if (!tracked) return <div>parts:none</div>;
  const [root, child] = tracked.topology.parts;
  const fuel = tracked.resourcesByFlightId.get(2)?.SolidFuel?.maxAmount;
  return (
    <div>
      {`parts:${tracked.topology.parts.length} root:${tracked.topology.rootFlightId} child:${child?.parentFlightId}@${child?.orgPos.join(",")} up:${root?.up?.join(",")} h:${child?.bounds.size.y} fuel:${fuel}`}
    </div>
  );
}

/** One craft's part tree as the mod sends it for an unloaded craft: bare numbers, no live fields. */
const WIRE = {
  parts: [
    {
      id: "1",
      parentId: null,
      name: "probeCoreSphere",
      title: "Stayputnik",
      position: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
      bounds: { size: { x: 0.6, y: 0.6, z: 0.6 }, center: null },
      dryMass: 0.05,
      inverseStage: 0,
      maxTemp: 1200,
      category: "Pods",
      modules: ["ModuleCommand"],
      resources: {},
    },
    {
      id: "2",
      parentId: "1",
      name: "solidBooster.sm.v2",
      title: "Flea",
      position: { x: 0, y: -1.5, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
      bounds: { size: { x: 0.6, y: 2.4, z: 0.6 }, center: null },
      dryMass: 0.45,
      inverseStage: 0,
      maxTemp: 2000,
      category: "Engine",
      modules: ["ModuleEngines"],
      resources: { SolidFuel: { amount: 62.5, maxAmount: 62.5 } },
    },
  ],
};

describe("useTrackedVesselTopology", () => {
  it("opens the craft's own parts topic and reads its bare-number tree as a diagram topology", async () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <TopologyProbe guid="g1" />
      </TelemetryProvider>,
    );
    expect(screen.getByText("parts:none")).toBeTruthy();
    expect(t.isSubscribed("trackingStation.vessel.g1.parts")).toBe(true);

    act(() => {
      t.emit("trackingStation.vessel.g1.parts", WIRE);
    });
    await waitFor(() =>
      expect(
        screen.getByText(
          "parts:2 root:1 child:1@0,-1.5,0 up:0,1,0 h:2.4 fuel:62.5",
        ),
      ).toBeTruthy(),
    );
  });

  it("knows nothing of a craft whose topic never delivers", () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <TopologyProbe guid="g2" />
      </TelemetryProvider>,
    );
    act(() => {
      t.emit("trackingStation.vessel.g1.parts", WIRE);
    });
    expect(screen.getByText("parts:none")).toBeTruthy();
  });
});
