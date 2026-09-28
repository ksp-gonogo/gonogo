import {
  clearAugments,
  clearRegistry,
  getAugmentsForSlot,
  registerAugment,
  WidgetMetaContext,
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
 * SystemView's augment slots: `system-view.actions` (header controls) and `system-view.overlay` (over the diagram, passed its projection). An empty slot renders cleanly, and a registered test augment appears, the overlay one receiving the projection.
 */

const KERBIN_MU = 3.5316e12;

describe("SystemView: augment slots (spec §4)", () => {
  let fixture: StreamFixture;
  // Unmount each tree before clearing the augment registry: RTL's auto-cleanup runs after this afterEach, and a clear on a mounted widget updates outside act().
  const renderedTrees: Array<() => void> = [];

  beforeEach(() => {
    clearRegistry();
    clearAugments();
    fixture = setupStreamFixture({
      pinnedUt: 100,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearAugments();
  });

  // Frame = Kerbin with children present, so the header slots and the overlay slot all render.
  async function renderDiagram() {
    const { unmount } = render(
      <fixture.Provider>
        {/* The identity the dashboard supplies, from which `Panel` completes its universal seam ids. */}
        <WidgetMetaContext.Provider
          value={{ componentId: "system-view", contributionSlots: [] }}
        >
          <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
        </WidgetMetaContext.Provider>
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
    await waitFor(() =>
      expect(screen.getAllByText("Kerbin").length).toBeGreaterThanOrEqual(1),
    );
  }

  it("exposes both slots on its component definition", () => {
    // The widget's module-load registration declared these slots, so each resolves to an empty augment list.
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
    // The overlay received the frame name, the measured diagram size, a positive plot scale and the origin-centred body position.
    expect(visibleText(overlay)).toContain("Kerbin:");
    expect(visibleText(overlay)).toContain(":scaled:");
    expect(visibleText(overlay)).toContain(":0,0");
  });
});
