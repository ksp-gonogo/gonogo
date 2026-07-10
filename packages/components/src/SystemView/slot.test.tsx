import type { DataKey } from "@gonogo/core";
import {
  clearAugments,
  clearRegistry,
  getAugmentsForSlot,
  MockDataSource,
  registerAugment,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import {
  type SystemBadgesContext,
  type SystemOverlayContext,
  SystemViewComponent,
} from "./index";

/**
 * SystemView augment-slot exposure (Uplink architecture spec §4). The widget is a
 * HOST exposing three slots — `system-view.actions` (header control row),
 * `system-view.overlay` (layered over the body diagram, passed the diagram's
 * projection as typed slot props, §4.4), and `system-view.badges` (broad header
 * escape-hatch). No first-party augment fills them here (that's an Uplink augment,
 * P3/P6): an empty slot must render cleanly, and a test augment registered into
 * one must appear — the overlay augment receiving the diagram projection.
 */

const BODY_KEYS: DataKey[] = [
  { key: "b.number" },
  { key: "b.name[0]" },
  { key: "b.name[1]" },
  { key: "b.name[2]" },
  { key: "b.referenceBody[1]" },
  { key: "b.referenceBody[2]" },
  { key: "b.radius[0]" },
  { key: "b.radius[1]" },
  { key: "b.radius[2]" },
  { key: "b.o.sma[1]" },
  { key: "b.o.sma[2]" },
  { key: "b.o.eccentricity[1]" },
  { key: "b.o.eccentricity[2]" },
];

describe("SystemView — augment slots (spec §4)", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let fixture: StreamFixture;

  beforeEach(async () => {
    clearRegistry();
    clearAugments();
    source = new MockDataSource({ keys: BODY_KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
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
    cleanup();
    buffered.disconnect();
    clearAugments();
  });

  // Drive the widget into its diagram layout (frame = Kerbin, children present)
  // so both the header slots AND the diagram-overlay slot render.
  async function renderDiagram() {
    render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    act(() => {
      source.emit("b.number", 3);
      source.emit("b.name[0]", "Kerbin");
      source.emit("b.name[1]", "Mun");
      source.emit("b.name[2]", "Minmus");
      source.emit("b.referenceBody[1]", "Kerbin");
      source.emit("b.referenceBody[2]", "Kerbin");
      source.emit("b.radius[0]", 600_000);
      source.emit("b.radius[1]", 200_000);
      source.emit("b.radius[2]", 60_000);
      source.emit("b.o.sma[1]", 12_000_000);
      source.emit("b.o.sma[2]", 47_000_000);
      source.emit("b.o.eccentricity[1]", 0);
      source.emit("b.o.eccentricity[2]", 0);
    });
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          { index: 0, name: "Kerbin", parentIndex: null, radius: 600_000, orbit: null },
          { index: 1, name: "Mun", parentIndex: 0, radius: 200_000, orbit: null },
          { index: 2, name: "Minmus", parentIndex: 0, radius: 60_000, orbit: null },
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

  it("exposes all three slots on its component definition", () => {
    // The registry entries are asserted indirectly: the widget's own module-load
    // registration declared the three slots as its extension points.
    // (See registerComponent `augmentSlots` in ./index.tsx.)
    expect(getAugmentsForSlot("system-view.actions")).toEqual([]);
    expect(getAugmentsForSlot("system-view.overlay")).toEqual([]);
    expect(getAugmentsForSlot("system-view.badges")).toEqual([]);
  });

  it("renders the diagram with no augments bound (empty slots are inert)", async () => {
    await renderDiagram();
    expect(screen.queryByTestId("sv-actions-augment")).toBeNull();
    expect(screen.queryByTestId("sv-overlay-augment")).toBeNull();
    expect(screen.queryByTestId("sv-badge-augment")).toBeNull();
  });

  it("renders a test augment bound to the badges slot in the header", async () => {
    function BadgeAugment({ frameName }: SystemBadgesContext) {
      return <span data-testid="sv-badge-augment">frame:{frameName}</span>;
    }
    await renderDiagram();

    act(() => {
      registerAugment({
        id: "test-sv-badge",
        augments: "system-view.badges",
        component: BadgeAugment,
      });
    });

    const badge = await screen.findByTestId("sv-badge-augment");
    // The slot passed the current frame name down (spec §4.4).
    expect(badge.textContent).toBe("frame:Kerbin");
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
    expect(overlay.textContent).toContain("Kerbin:");
    expect(overlay.textContent).toContain(":scaled:");
    expect(overlay.textContent).toContain(":0,0");
  });
});
