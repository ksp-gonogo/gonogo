import type { VesselTopology } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
import fuellinePrelaunch from "./__fixtures__/fuelline-tester-22parts-prelaunch.json";
import { ShipMapComponent } from "./index";

const TOPOLOGY = fuellinePrelaunch["v.topology"] as VesselTopology;
const PARTS = topologyToVesselPartsWire(TOPOLOGY, new Map());

function mount() {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  render(
    <fixture.Provider>
      <ShipMapComponent id="ship-map-destroyed" w={8} h={10} />
    </fixture.Provider>,
  );
  return fixture;
}

function crashReport(lostIds: number[]) {
  return {
    vesselName: "Kerbal X",
    ut: 0,
    partsLost: lostIds.map((partId) => ({
      partId,
      partTitle: "Mk1 Command Pod",
    })),
    kerbalsKilled: ["Jebediah Kerman"],
  };
}

function impactMarks(container: HTMLElement): number {
  return container.querySelectorAll('[data-role="impact-mark"]').length;
}

async function drawThenDestroy(report: Record<string, unknown>) {
  const fixture = mount();
  act(() => {
    fixture.emit("vessel.parts", PARTS);
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
  );
  act(() => {
    fixture.emit("crash.hasRecent", { recent: true });
    fixture.emit("crash.lastCrash", report);
    fixture.emit("vessel.parts", null);
  });
  await waitFor(() => expect(screen.getByText("Destroyed")).toBeTruthy());
}

describe("ShipMap: the craft it shows was destroyed", () => {
  it("keeps the diagram and marks only the part that broke first", async () => {
    const ids = TOPOLOGY.parts.map((p) => p.flightId);
    await drawThenDestroy({
      ...crashReport(ids),
      eventKind: "Crash",
      altitude: 412.6,
    });

    expect(screen.getByLabelText("Ship diagram")).toBeTruthy();
    expect(impactMarks(document.body)).toBe(1);
    expect(screen.queryByText("First to break")).toBeNull();
    expect(screen.queryByText(/\d+ parts?$/)).toBeNull();
    expect(screen.queryByText("Hit")).toBeNull();
    expect(screen.queryByText(/Waiting for vessel topology/)).toBeNull();
  });

  it("marks no part for a burn-up, which names no point of impact", async () => {
    const ids = TOPOLOGY.parts.map((p) => p.flightId);
    await drawThenDestroy({ ...crashReport(ids), eventKind: "Destroyed" });

    expect(screen.getByLabelText("Ship diagram")).toBeTruthy();
    expect(impactMarks(document.body)).toBe(0);
    expect(screen.getByText("Destroyed")).toBeTruthy();
  });

  it("marks nothing while no crash is on record", async () => {
    const fixture = mount();
    act(() => {
      fixture.emit("vessel.parts", PARTS);
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
    );
    expect(impactMarks(document.body)).toBe(0);
    expect(screen.queryByText("Destroyed")).toBeNull();
  });

  it("says what was lost when the craft was never drawn here", async () => {
    const fixture = mount();
    act(() => {
      fixture.emit("crash.hasRecent", { recent: true });
      fixture.emit("crash.lastCrash", crashReport([1, 2]));
    });

    await waitFor(() => expect(screen.getByText("Destroyed")).toBeTruthy());
    expect(screen.getByText("2 parts lost")).toBeTruthy();
    expect(screen.queryByLabelText("Ship diagram")).toBeNull();
  });

  it("keeps the topology wait when no crash is on record", () => {
    mount();
    expect(screen.getByText(/Waiting for vessel topology/)).toBeTruthy();
    expect(screen.queryByText("Destroyed")).toBeNull();
  });
});
