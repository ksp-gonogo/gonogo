import {
  clearActionHandlers,
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
  type VesselTopology,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { heldGradeOf } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import {
  VesselSchematicComponent,
  type VesselSchematicOverlayContext,
} from "./index";

/**
 * The `vessel-schematic.overlay` slot ships no filler: empty it renders cleanly, and a
 * registered test augment appears with the projection context as typed props.
 */

const TOPOLOGY = fuellinePostStage2["v.topology"] as VesselTopology;
const VESSEL_PARTS_WIRE = topologyToVesselPartsWire(TOPOLOGY);

// Unmount each tree before clearing the registries: RTL's auto-cleanup runs after this afterEach, too late.
const renderedTrees: Array<() => void> = [];

// Drive the widget to its diagram layout, where the overlay slot renders.
async function renderDiagram() {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  const { unmount } = render(
    <fixture.Provider>
      <VesselSchematicComponent id="vessel-schematic-slot" w={8} h={10} />
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  act(() => {
    fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
  );
  return fixture;
}

describe("VesselSchematic: augment slots (spec §4)", () => {
  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearActionHandlers();
    clearAugments();
  });

  it("exposes the slot (empty until an augment binds)", () => {
    // The widget's own registration declared the slot.
    expect(getAugmentsForSlot("vessel-schematic.overlay")).toEqual([]);
  });

  it("renders the diagram with no augment bound (an empty slot is inert)", async () => {
    await renderDiagram();
    // An empty slot adds nothing to the stock diagram.
    expect(screen.getByLabelText("Ship diagram")).toBeTruthy();
    expect(screen.queryByTestId("vessel-schematic-overlay-augment")).toBeNull();
  });

  it("renders a test augment bound to the overlay slot, passing the diagram projection as slot props", async () => {
    function OverlayAugment({
      parts,
      width,
      height,
      baseScale,
    }: VesselSchematicOverlayContext) {
      return (
        <div data-testid="vessel-schematic-overlay-augment">
          {parts.length}|{width}x{height}|{baseScale > 0 ? "scaled" : "flat"}
        </div>
      );
    }
    await renderDiagram();

    act(() => {
      registerAugment({
        id: "test-vessel-schematic-overlay",
        augments: "vessel-schematic.overlay",
        component: OverlayAugment,
      });
    });

    const overlay = await screen.findByTestId(
      "vessel-schematic-overlay-augment",
    );
    // The fixture's part count, the measured canvas size and a positive scale reached the augment.
    expect(visibleText(overlay)).toContain(`${TOPOLOGY.parts.length}|`);
    expect(visibleText(overlay)).toContain("scaled");
  });

  it("hands the overlay the parts reading, so it can draw the live part fields held once updates stop", async () => {
    function CurrencyAugment({ held }: VesselSchematicOverlayContext) {
      return (
        <div data-testid="vessel-schematic-overlay-currency">
          {heldGradeOf(held) ?? "current"}
        </div>
      );
    }
    const fixture = await renderDiagram();
    act(() => {
      registerAugment({
        id: "test-vessel-schematic-overlay-currency",
        augments: "vessel-schematic.overlay",
        component: CurrencyAugment,
      });
    });

    const overlay = await screen.findByTestId(
      "vessel-schematic-overlay-currency",
    );
    expect(visibleText(overlay)).toBe("current");

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    await waitFor(() =>
      expect(visibleText(overlay)).toBe(
        heldGradeOf(fixture.store.sampleReading("vessel.parts")),
      ),
    );
    expect(visibleText(overlay)).not.toBe("current");
  });
});
