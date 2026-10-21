import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  craftFileSegment,
  craftFileTopic,
  useCraftFileTopology,
} from "./useCraftFileTopology";

function TopologyProbe({ facility, file }: { facility: string; file: string }) {
  const tracked = useCraftFileTopology(facility, file);
  if (!tracked) return <div>parts:none</div>;
  const [, child] = tracked.topology.parts;
  return (
    <div>{`parts:${tracked.topology.parts.length} child:${child?.parentFlightId} fuel:${tracked.resourcesByFlightId.get(2)?.SolidFuel?.maxAmount}`}</div>
  );
}

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

describe("craftFileSegment", () => {
  it("keeps letters, digits, underscores and hyphens and escapes every other byte", () => {
    expect(craftFileSegment("Kerbal-X_2")).toBe("Kerbal-X_2");
    expect(craftFileSegment("Kerbal X v1.2")).toBe("Kerbal%20X%20v1%2E2");
    expect(craftFileSegment("Ré")).toBe("R%C3%A9");
    expect(craftFileSegment("a.b")).not.toContain(".");
  });

  it("keys the topic by facility so a VAB and an SPH file of one name differ", () => {
    expect(craftFileTopic("VAB", "Probe")).toBe(
      "spaceCenter.craft.VAB.Probe.parts",
    );
    expect(craftFileTopic("SPH", "Probe")).not.toBe(
      craftFileTopic("VAB", "Probe"),
    );
  });
});

describe("useCraftFileTopology", () => {
  it("opens the file's own parts topic and reads its tree as a diagram topology", async () => {
    const t = new StubTransport();
    render(
      <TelemetryProvider client={new TelemetryClient(t)}>
        <TopologyProbe facility="VAB" file="Wave v1.2" />
      </TelemetryProvider>,
    );
    expect(screen.getByText("parts:none")).toBeTruthy();
    expect(t.isSubscribed("spaceCenter.craft.VAB.Wave%20v1%2E2.parts")).toBe(
      true,
    );

    act(() => {
      t.emit("spaceCenter.craft.VAB.Wave%20v1%2E2.parts", WIRE);
    });
    await waitFor(() =>
      expect(screen.getByText("parts:2 child:1 fuel:62.5")).toBeTruthy(),
    );
  });

  it("knows nothing of a file whose topic never delivers", () => {
    const t = new StubTransport();
    render(
      <TelemetryProvider client={new TelemetryClient(t)}>
        <TopologyProbe facility="VAB" file="Other" />
      </TelemetryProvider>,
    );
    act(() => {
      t.emit("spaceCenter.craft.VAB.Wave.parts", WIRE);
    });
    expect(screen.getByText("parts:none")).toBeTruthy();
  });
});
