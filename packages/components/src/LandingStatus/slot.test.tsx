import type { DataKey } from "@ksp-gonogo/core";
import {
  clearActionHandlers,
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  type LandingStatusBadgesContext,
  LandingStatusComponent,
} from "./index";

/**
 * LandingStatus augment-slot exposure (Uplink architecture). The widget
 * exposes one BROAD header escape-hatch slot (`landing-status.badges`) but
 * ships no filler here (that's an Uplink augment): an empty slot must
 * render cleanly, and a test augment registered into it must appear in the
 * header, receiving the widget's labelling context as typed slot props.
 */

const KEYS: DataKey[] = [
  { key: "v.body" },
  { key: "v.heightFromTerrain" },
  { key: "v.verticalSpeed" },
  { key: "land.timeToImpact" },
  { key: "land.speedAtImpact" },
  { key: "land.suicideBurnCountdown" },
  { key: "land.predictedLat" },
  { key: "land.predictedLon" },
  { key: "land.slopeAngle" },
];

// The header row renders unconditionally, so the badges slot is present even in
// the idle "no landing" state — no need to drive a full prediction.
async function renderWidget() {
  const fixture = await setupMockDataSource({
    id: "data",
    keys: KEYS,
    connectSource: true,
  });
  registerStockBodies();
  render(<LandingStatusComponent config={{}} id="landing-status-slot" />);
  act(() => {
    fixture.source.emit("v.body", "Mun");
  });
  await screen.findByText("LANDING");
  return fixture;
}

describe("LandingStatus — augment slots (spec §4)", () => {
  afterEach(() => {
    cleanup();
    clearActionHandlers();
    // Wipe any test augment so it never leaks into the snapshot suite.
    clearAugments();
  });

  it("exposes the badges slot (empty until an augment binds)", () => {
    // The registry entry is asserted indirectly: the widget's own module-load
    // registration declared the slot as its extension point.
    // (See registerComponent `augmentSlots` in ./index.tsx.)
    expect(getAugmentsForSlot("landing-status.badges")).toEqual([]);
  });

  it("renders the header with no augments bound (empty slot is inert)", async () => {
    const fixture = await renderWidget();
    expect(screen.getByText("LANDING")).toBeTruthy();
    expect(screen.queryByTestId("landing-status-badge-augment")).toBeNull();
    teardownMockDataSource(fixture);
  });

  it("renders a test augment bound to the badges slot in the header", async () => {
    function BadgeAugment({
      bodyName,
      atmospheric,
    }: LandingStatusBadgesContext) {
      return (
        <span data-testid="landing-status-badge-augment">
          {bodyName ?? "?"}|{atmospheric ? "atm" : "vac"}
        </span>
      );
    }
    const fixture = await renderWidget();

    act(() => {
      registerAugment({
        id: "test-landing-status-badge",
        augments: "landing-status.badges",
        component: BadgeAugment,
      });
    });

    const badge = await screen.findByTestId("landing-status-badge-augment");
    // The slot passed the widget's labelling context down: the
    // current body and its atmosphere flag (Mun is a vacuum body).
    expect(badge.textContent).toBe("Mun|vac");
    teardownMockDataSource(fixture);
  });
});
