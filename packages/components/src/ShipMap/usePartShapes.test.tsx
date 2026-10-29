import type { TopologyPart, VesselTopology } from "@ksp-gonogo/core";
import { type DecodedPartShape, partShapeTopic } from "@ksp-gonogo/data";
import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { CraftDiagram } from "../LaunchDirector/CraftDiagram";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
import fuellinePrelaunch from "./__fixtures__/fuelline-tester-22parts-prelaunch.json";
import winglet from "./__fixtures__/shapes/R8winglet.json";
import { ShipMapComponent } from "./index";
import { usePartShapes } from "./usePartShapes";

const parts = [
  { flightId: 1, shape: "R8winglet" },
  { flightId: 2, shape: "R8winglet" },
  { flightId: 3, shape: "fuelTank" },
  { flightId: 4 },
] as TopologyPart[];

function Probe() {
  const { shapes, sources } = usePartShapes(parts);
  return (
    <>
      {sources}
      <div>{`shapes:${[...shapes.keys()].join(",") || "none"}`}</div>
    </>
  );
}

describe("usePartShapes", () => {
  it("opens each kind of part's shape once and hands over each as it arrives", async () => {
    const t = new StubTransport();
    render(
      <TelemetryProvider client={new TelemetryClient(t)}>
        <Probe />
      </TelemetryProvider>,
    );
    expect(screen.getByText("shapes:none")).toBeTruthy();
    expect(t.isSubscribed(partShapeTopic("R8winglet"))).toBe(true);
    expect(t.isSubscribed(partShapeTopic("fuelTank"))).toBe(true);

    act(() => {
      t.emit(partShapeTopic("R8winglet"), winglet);
    });
    await waitFor(() =>
      expect(screen.getByText("shapes:R8winglet")).toBeTruthy(),
    );
  });
});

/* A captured craft whose every part names its own kind's shape. */
const TOPOLOGY = fuellinePrelaunch["v.topology"] as VesselTopology;
const SHAPED: VesselTopology = {
  ...TOPOLOGY,
  parts: TOPOLOGY.parts.map((p) => ({ ...p, shape: p.name })),
};
const KINDS = [...new Set(SHAPED.parts.map((p) => p.name))];

describe("shapes shared between widgets", () => {
  it("opens one subscription per kind of part, and hands every widget the same unpacked shape", async () => {
    const fixture = setupStreamFixture();
    const subscribes: string[] = [];
    const send = fixture.transport.send.bind(fixture.transport);
    fixture.transport.send = (message) => {
      if (message.type === "subscribe") subscribes.push(message.topic);
      send(message);
    };
    const seen: (DecodedPartShape | undefined)[] = [];
    function Witness() {
      const { shapes, sources } = usePartShapes(SHAPED.parts);
      seen.push(shapes.get(KINDS[0]));
      return <>{sources}</>;
    }
    const wire = topologyToVesselPartsWire(TOPOLOGY, new Map());
    const parts = wire.parts.map((part, i) => ({
      ...part,
      shape: SHAPED.parts[i].shape,
    }));
    render(
      <fixture.Provider>
        <ShipMapComponent id="ship-map-a" w={8} h={10} />
        <ShipMapComponent id="ship-map-b" w={8} h={10} />
        <CraftDiagram topology={SHAPED} />
        <Witness />
        <Witness />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.parts", { ...wire, parts });
    });
    await waitFor(() => expect(subscribes).toContain(partShapeTopic(KINDS[0])));

    for (const kind of KINDS) {
      expect(
        subscribes.filter((t) => t === partShapeTopic(kind)),
        kind,
      ).toHaveLength(1);
    }

    act(() => {
      fixture.emit(partShapeTopic(KINDS[0]), { ...winglet, name: KINDS[0] });
    });
    await waitFor(() => expect(seen.at(-1)).toBeDefined());
    const handed = seen.slice(-2);
    expect(handed[0]).toBe(handed[1]);
  });
});
