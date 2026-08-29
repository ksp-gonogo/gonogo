import type { VesselTopology } from "@ksp-gonogo/core";
import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { resourceColor } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
// Importing the real module runs its module-load registration of the
// built-in `ship-map.part-meters` contribution (./partMetersContribution.ts,
// a side-effect import inside this file), the same way importing any widget
// runs its own `registerComponent`.
import { ShipMapComponent } from "./index";

/**
 * Proves the self-contribution unify end to end: ShipMap's
 * compact fill bars come from the aggregated `ship-map.part-meters` slot,
 * not from a hardcoded resource allowlist inside `ShipDiagramSvg`. The
 * built-in `core` contribution is exercised here (it lives in this
 * package); an Uplink contribution's OWN pure-function tests live alongside
 * it in that Uplink.
 *
 * `WidgetMetaContext` + `ContributionsProvider` are mounted explicitly here
 * (mirrors the app's real `WidgetContributions` wrapper,
 * `GridItemContent.tsx`): `ShipMapComponent` alone, the way `slot.test.tsx`
 * renders it, has no contribution store at all and `useContributions`
 * silently returns empty, same as a bare widget with no dashboard around it.
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
    carriedChannels: ["vessel.parts"],
    pinnedUt: 10,
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

  it("paints each resource's identity colour (resourceColor), not a shared MeterTone CSS var", async () => {
    const { container } = await renderShipMap();
    // The fill is the resource's own identity colour, derived straight from `resourceColor`, not a five-value MeterTone CSS var shared across unrelated resources.
    const fills = Array.from(container.querySelectorAll("rect")).map((r) =>
      r.getAttribute("fill"),
    );
    expect(fills).toContain(resourceColor("LiquidFuel"));
    expect(fills).toContain(resourceColor("Oxidizer"));
    expect(resourceColor("LiquidFuel")).not.toBe(resourceColor("Oxidizer"));
    // Neither the old bespoke `resourceColor` switch's CSS var nor the
    // MeterTone CSS vars it was replaced with, then replaced again, should
    // ever appear as a fill on a healthy (no-status) resource meter.
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
    // `renderResourceFill`'s own wrapper (`<g pointerEvents="none">`) is the
    // fill-bar marker; a part's unconditional focus-ring `<rect>` is not.
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
    // The status (5 / 180 = 2.8%, below the critical threshold) shows as a
    // SEPARATE stroke on the track rect, never as a fill colour swap.
    expect(
      rects.some(
        (r) => r.getAttribute("stroke") === "var(--color-status-nogo-bg)",
      ),
    ).toBe(true);
  });
});
