import type { DataKey } from "@ksp-gonogo/core";
import {
  clearAugments,
  clearRegistry,
  getAugmentsForSlot,
  MockDataSource,
  registerAugment,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type GroundSurveyBadgesContext, GroundSurveyComponent } from "./index";

/**
 * GroundSurvey augment-slot exposure (Uplink architecture spec §4). The
 * broad header `ground-survey.badges` escape-hatch slot (§4.8) is exposed but
 * ships no filler here (that's an Uplink augment, P3/P6): an empty slot must
 * render cleanly, and a test augment registered into it must appear beside the
 * smoothness badge, receiving the widget's labelling context as typed slot
 * props (§4.4).
 */

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.body" },
  { key: "v.altitude" },
  { key: "v.heightFromTerrain" },
  { key: "v.surfaceSpeed" },
  { key: "v.splashed" },
  { key: "land.predictedLat" },
  { key: "land.predictedLon" },
];

describe("GroundSurvey — augment slots (spec §4)", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let now = 0;

  beforeEach(async () => {
    clearRegistry();
    clearAugments();
    source = new MockDataSource({ keys: KEYS });
    now = 1_000_000;
    buffered = new BufferedDataSource({
      source,
      store: new MemoryStore(),
      now: () => now,
    });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
    clearAugments();
  });

  // Drive the widget to its surveying phase (body + an alt/hft pair above the
  // freeze threshold), where the header badge area renders.
  function drive(body = "Mun") {
    act(() => {
      source.emit("v.name", "Test");
      source.emit("v.missionTime", 0);
      source.emit("v.body", body);
    });
    now += 200;
    act(() => {
      source.emit("v.altitude", 50_000);
      source.emit("v.heightFromTerrain", 5_000);
    });
  }

  it("exposes the badges slot (empty until an augment binds)", () => {
    expect(getAugmentsForSlot("ground-survey.badges")).toEqual([]);
  });

  it("renders with no augment bound (empty slot is inert)", () => {
    render(<GroundSurveyComponent config={{}} id="survey" />);
    drive();
    expect(screen.getByText(/surveying/)).toBeInTheDocument();
    expect(screen.queryByTestId("ground-survey-badge-augment")).toBeNull();
  });

  it("renders a test augment bound to the badges slot, passing labelling context as slot props", () => {
    function BadgeAugment({ body, surveyState }: GroundSurveyBadgesContext) {
      return (
        <span data-testid="ground-survey-badge-augment">
          {body}:{surveyState}
        </span>
      );
    }
    render(<GroundSurveyComponent config={{}} id="survey" />);
    drive();

    act(() => {
      registerAugment({
        id: "test-ground-survey-badge",
        augments: "ground-survey.badges",
        component: BadgeAugment,
      });
    });

    const badge = screen.getByTestId("ground-survey-badge-augment");
    expect(badge.textContent).toBe("Mun:active");
  });
});
