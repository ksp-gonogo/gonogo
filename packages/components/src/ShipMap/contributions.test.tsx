import type { VesselTopology } from "@ksp-gonogo/core";
import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { resourceColor } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
// Importing the module registers the built-in `ship-map.part-meters` contribution.
import { ShipMapComponent } from "./index";

/**
 * ShipMap's fill bars come from the aggregated `ship-map.part-meters` slot,
 * exercised here with the built-in contribution. The contribution providers
 * are mounted explicitly, as the app's `WidgetContributions` does; without
 * them `useContributions` returns empty.
 */

const TOPOLOGY: VesselTopology = {
  topologySeq: 1,
  rootFlightId: 1,
  parts: [
    {
      flightId: 1,
      persistentId: 1,
      parentFlightId: null,
      name: "mk1pod",
      title: "Mk1 Command Pod",
      manufacturer: "",
      category: "Pods",
      inverseStage: -1,
      crewCapacity: 1,
      maxTemp: 1200,
      crashTolerance: 0,
      dryMass: 0.8,
      orgPos: [0, 0, 0],
      up: [0, 1, 0],
      bounds: { size: { x: 1.25, y: 1.14, z: 1.25 } },
      modules: ["ModuleCommand"],
    },
    {
      flightId: 2,
      persistentId: 2,
      parentFlightId: 1,
      name: "fuelTankSmallFlat",
      title: "FL-T400 Fuel Tank",
      manufacturer: "",
      category: "FuelTank",
      inverseStage: 1,
      crewCapacity: 0,
      maxTemp: 2000,
      crashTolerance: 0,
      dryMass: 0.25,
      orgPos: [0, -1.145, 0],
      up: [0, 1, 0],
      bounds: { size: { x: 1.25, y: 1.85, z: 1.25 } },
      modules: [],
    },
  ],
};

const VESSEL_PARTS_WIRE = topologyToVesselPartsWire(
  TOPOLOGY,
  new Map([
    [
      2,
      {
        resources: {
          LiquidFuel: { amount: 90, maxAmount: 180 },
          Oxidizer: { amount: 100, maxAmount: 220 },
        },
      },
    ],
  ]),
);

const META = {
  componentId: "ship-map",
  contributionSlots: ["ship-map.part-meters", "ship-map.part-meta"] as const,
};

const renderedTrees: Array<() => void> = [];

async function renderShipMap(wire = VESSEL_PARTS_WIRE) {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  const { unmount, container } = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider value={META}>
        <ContributionsProvider>
          <ShipMapComponent id="ship-map-contrib" w={8} h={10} />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  act(() => {
    fixture.emit("vessel.parts", wire);
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
  );
  return { container };
}

describe("ShipMap: self-contribution unify (spec §13.4)", () => {
  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
  });

  it("paints each resource's identity colour (resourceColor), not a shared tone CSS var", async () => {
    const { container } = await renderShipMap();
    // The fill is the resource's own identity colour from `resourceColor`, not a shared tone variable.
    const fills = Array.from(container.querySelectorAll("rect")).map((r) =>
      r.getAttribute("fill"),
    );
    expect(fills).toContain(resourceColor("LiquidFuel"));
    expect(fills).toContain(resourceColor("Oxidizer"));
    expect(resourceColor("LiquidFuel")).not.toBe(resourceColor("Oxidizer"));
    // No shared tone variable ever fills a healthy meter.
    expect(fills).not.toContain("var(--color-accent-fg)");
    expect(fills).not.toContain("var(--color-status-go-bg)");
    expect(fills).not.toContain("var(--color-status-info-bg)");
  });

  it("composes the contributed percentage into the part's accessible name", async () => {
    await renderShipMap();
    expect(
      screen.getByLabelText(/FL-T400 Fuel Tank.*LiquidFuel 50 percent/),
    ).toBeTruthy();
  });

  it("renders no bars on a part with no contributed meters (the command pod)", async () => {
    await renderShipMap();
    const pod = screen.getByLabelText(/Mk1 Command Pod/);
    // The fill-bar wrapper marks a bar; the part's focus-ring rect does not.
    expect(pod.querySelector('g[pointer-events="none"]')).toBeNull();
  });

  it("has no axe violations with contributed meters rendered", async () => {
    const { container } = await renderShipMap();
    await expectNoA11yViolations(container);
  });

  it("draws a status border on a low resource without changing its identity fill hue", async () => {
    const criticalWire = topologyToVesselPartsWire(
      TOPOLOGY,
      new Map([
        [2, { resources: { LiquidFuel: { amount: 5, maxAmount: 180 } } }],
      ]),
    );
    const { container } = await renderShipMap(criticalWire);
    const rects = Array.from(container.querySelectorAll("rect"));
    // Identity fill is unchanged by status: still LiquidFuel's own colour.
    expect(
      rects.some((r) => r.getAttribute("fill") === resourceColor("LiquidFuel")),
    ).toBe(true);
    // 5 / 180 is below critical, shown as a separate stroke on the track, never a fill swap.
    expect(
      rects.some(
        (r) => r.getAttribute("stroke") === "var(--color-status-nogo-bg)",
      ),
    ).toBe(true);
  });
});
