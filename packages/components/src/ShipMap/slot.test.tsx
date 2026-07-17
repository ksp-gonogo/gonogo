import {
  clearActionHandlers,
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import {
  type ShipMapBadgesContext,
  ShipMapComponent,
  type ShipMapOverlayContext,
} from "./index";

/**
 * ShipMap augment-slot exposure (Uplink architecture). The slots
 * (`ship-map.overlay`, `ship-map.badges`) are exposed but ship no filler here
 * (that's an Uplink augment's job): an empty slot must render cleanly, and a
 * test augment registered into it must appear, receiving the widget's projection
 * / labelling context as typed slot props.
 */

const TOPOLOGY = fuellinePostStage2["v.topology"];
const VESSEL_PARTS_WIRE = topologyToVesselPartsWire(TOPOLOGY);

// Unmount each rendered tree BEFORE clearing the action-handler/augment
// registries — a clear firing on a still-mounted widget is a state update
// outside act(). RTL auto-cleanup runs after this file's afterEach, too late
// to unmount first.
const renderedTrees: Array<() => void> = [];

// Drive the widget to its diagram layout (topology present with parts), where
// both the `badges` header slot and the `overlay` diagram slot render.
async function renderDiagram() {
  const fixture = setupStreamFixture({
    carriedChannels: ["vessel.parts"],
    pinnedUt: 10,
  });
  const { unmount } = render(
    <fixture.Provider>
      <ShipMapComponent id="ship-map-slot" w={8} h={10} />
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

describe("ShipMap — augment slots (spec §4)", () => {
  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearActionHandlers();
    // Wipe any test augment so it never leaks into the snapshot suite.
    clearAugments();
  });

  it("exposes both slots (empty until an augment binds)", () => {
    // The registry entry is asserted indirectly: the widget's own module-load
    // registration declared the two slots as its extension points.
    // (See registerComponent `augmentSlots` in ./index.tsx.)
    expect(getAugmentsForSlot("ship-map.overlay")).toEqual([]);
    expect(getAugmentsForSlot("ship-map.badges")).toEqual([]);
  });

  it("renders the diagram with no augments bound (empty slots are inert)", async () => {
    await renderDiagram();
    // Empty slots add nothing — the stock diagram renders exactly as before.
    expect(screen.getByLabelText("Ship diagram")).toBeTruthy();
    expect(screen.queryByTestId("ship-map-overlay-augment")).toBeNull();
    expect(screen.queryByTestId("ship-map-badge-augment")).toBeNull();
  });

  it("renders a test augment bound to the overlay slot, passing the diagram projection as slot props", async () => {
    function OverlayAugment({
      parts,
      width,
      height,
      baseScale,
    }: ShipMapOverlayContext) {
      return (
        <div data-testid="ship-map-overlay-augment">
          {parts.length}|{width}x{height}|{baseScale > 0 ? "scaled" : "flat"}
        </div>
      );
    }
    await renderDiagram();

    act(() => {
      registerAugment({
        id: "test-ship-map-overlay",
        augments: "ship-map.overlay",
        component: OverlayAugment,
      });
    });

    const overlay = await screen.findByTestId("ship-map-overlay-augment");
    // The slot passed the diagram's base-frame projection down:
    // the fixture's part count, the measured canvas size, a positive scale.
    expect(overlay.textContent).toContain(`${TOPOLOGY.parts.length}|`);
    expect(overlay.textContent).toContain("scaled");
  });

  it("renders a test augment bound to the badges slot in the header", async () => {
    function BadgeAugment({ partCount }: ShipMapBadgesContext) {
      return <span data-testid="ship-map-badge-augment">{partCount}p</span>;
    }
    await renderDiagram();

    act(() => {
      registerAugment({
        id: "test-ship-map-badge",
        augments: "ship-map.badges",
        component: BadgeAugment,
      });
    });

    const badge = await screen.findByTestId("ship-map-badge-augment");
    expect(badge.textContent).toBe(`${TOPOLOGY.parts.length}p`);
  });
});
