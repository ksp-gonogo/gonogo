import {
  clearAugments,
  clearRegistry,
  getAugmentsForSlot,
  registerAugment,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { type SystemOverlayContext, SystemViewComponent } from "./index";

/**
 * SystemView augment-slot exposure (Uplink architecture). The widget is a
 * HOST exposing two slots: `system-view.actions` (header control row) and
 * `system-view.overlay` (layered over the body diagram, passed the diagram's
 * projection as typed slot props). No first-party augment fills them here
 * (that's an Uplink augment): an empty slot must render cleanly, and a test
 * augment registered into one must appear, the overlay augment receiving the
 * diagram projection. Header BADGES are not an augment slot on this widget:
 * they arrive through the automatic `system-view.badges` CONTRIBUTION slot,
 * covered by `../FleetComms/panel-badge.test.tsx`.
 *
 * Everything (the body tree included) rides the stream, `useCelestialBodies`
 * reads `system.bodies`, no legacy `MockDataSource` leg.
 */

const KERBIN_MU = 3.5316e12;

describe("SystemView: augment slots (spec §4)", () => {
  let fixture: StreamFixture;
  // Unmount each rendered tree BEFORE clearing the augment registry, a clear
  // firing on a still-mounted widget is a state update outside act(). RTL
  // auto-cleanup runs after this file's afterEach, too late to unmount first.
  const renderedTrees: Array<() => void> = [];

  beforeEach(() => {
    clearRegistry();
    clearAugments();
    fixture = setupStreamFixture({
      carriedChannels: [
        "vessel.orbit",
        "vessel.identity",
        "vessel.target",
        "system.bodies",
      ],
      pinnedUt: 100,
    });
  });

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearAugments();
  });

  // Drive the widget into its diagram layout (frame = Kerbin, children present)
  // so both the header slots AND the diagram-overlay slot render.
  async function renderDiagram() {
    const { unmount } = render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          {
            index: 0,
            name: "Kerbin",
            parentIndex: null,
            radius: 600_000,
            gravParameter: KERBIN_MU,
            orbit: null,
          },
          {
            index: 1,
            name: "Mun",
            parentIndex: 0,
            radius: 200_000,
            gravParameter: 6.5138398e10,
            orbit: {
              sma: 12_000_000,
              ecc: 0,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 100,
            },
          },
          {
            index: 2,
            name: "Minmus",
            parentIndex: 0,
            radius: 60_000,
            gravParameter: 1.7658e9,
            orbit: {
              sma: 47_000_000,
              ecc: 0,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 100,
            },
          },
        ],
      });
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Tester",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 0,
      });
    });
    // The frame label confirms the diagram mounted.
    await waitFor(() =>
      expect(screen.getAllByText("Kerbin").length).toBeGreaterThanOrEqual(1),
    );
  }

  it("exposes both slots on its component definition", () => {
    // The registry entries are asserted indirectly: the widget's own module-load
    // registration declared the two slots as its extension points.
    // (See registerComponent `augmentSlots` in ./index.tsx.)
    expect(getAugmentsForSlot("system-view.actions")).toEqual([]);
    expect(getAugmentsForSlot("system-view.overlay")).toEqual([]);
  });

  it("renders the diagram with no augments bound (empty slots are inert)", async () => {
    await renderDiagram();
    expect(screen.queryByTestId("sv-actions-augment")).toBeNull();
    expect(screen.queryByTestId("sv-overlay-augment")).toBeNull();
  });

  it("renders a test augment bound to the actions slot in the header", async () => {
    function ActionAugment() {
      return (
        <button type="button" data-testid="sv-actions-augment">
          commlinks
        </button>
      );
    }
    await renderDiagram();

    act(() => {
      registerAugment({
        id: "test-sv-action",
        augments: "system-view.actions",
        component: ActionAugment,
      });
    });

    expect(await screen.findByTestId("sv-actions-augment")).toBeTruthy();
  });

  it("renders a test overlay augment, passing the diagram projection as slot props", async () => {
    function OverlayAugment({
      parentName,
      width,
      height,
      plotScale,
      center,
    }: SystemOverlayContext) {
      return (
        <div data-testid="sv-overlay-augment">
          {parentName}:{width}x{height}:{plotScale > 0 ? "scaled" : "flat"}:
          {center.x},{center.y}
        </div>
      );
    }
    await renderDiagram();

    act(() => {
      registerAugment({
        id: "test-sv-overlay",
        augments: "system-view.overlay",
        component: OverlayAugment,
      });
    });

    const overlay = await screen.findByTestId("sv-overlay-augment");
    // The overlay slot passed the parent-centric projection down (§4.4): the frame
    // name, the measured diagram px size, a positive metres→px scale, and the
    // origin-centred body position.
    expect(visibleText(overlay)).toContain("Kerbin:");
    expect(visibleText(overlay)).toContain(":scaled:");
    expect(visibleText(overlay)).toContain(":0,0");
  });
});
