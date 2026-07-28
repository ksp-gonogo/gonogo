import {
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render as rtlRender, screen } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { type GroundSurveyBadgesContext, GroundSurveyComponent } from "./index";

// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// augment registry. RTL auto-cleanup runs after this file's afterEach, so it
// can't be relied on to unmount first, clearAugments() firing on a
// still-mounted widget is a state update outside act(), the documented
// anti-pattern in CLAUDE.md.
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

function unmountAll() {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
}

/**
 * GroundSurvey augment-slot exposure (Uplink architecture). The
 * broad header `ground-survey.badges` escape-hatch slot is exposed but
 * ships no filler here (that's an Uplink augment): an empty slot must
 * render cleanly, and a test augment registered into it must appear beside the
 * smoothness badge, receiving the widget's labelling context as typed slot
 * props.
 *
 * `v.body`/altitude/heightFromTerrain all stream natively now: `v.body`
 * via `vessel.state.parentBodyName` (`vessel.identity` + `system.bodies`),
 * altitude/heightFromTerrain via `vessel.flight`: see
 * `useGroundSurveySamples`'s doc comment.
 */
describe("GroundSurvey: augment slots (spec §4)", () => {
  let streamFixture: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    clearAugments();
    streamFixture = setupStreamFixture({ carriedChannels: [] });
  });

  afterEach(() => {
    unmountAll();
    clearAugments();
  });

  // Drive the widget to its surveying phase (body + an alt/hft pair above the
  // freeze threshold), where the header badge area renders.
  function drive(body = "Mun") {
    act(() => {
      streamFixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      streamFixture.emit("vessel.identity", { parentBodyIndex: 1 });
      streamFixture.emit("system.bodies", {
        bodies: [
          {
            name: body,
            index: 1,
            parentIndex: 0,
            radius: 600_000,
            orbit: null,
          },
        ],
      });
      streamFixture.emit("vessel.flight", {
        latitude: 0,
        longitude: 0,
        altitudeAsl: 50_000,
        altitudeTerrain: 5_000,
        verticalSpeed: 0,
        surfaceSpeed: 0,
        orbitalSpeed: 0,
        gForce: 0,
        dynamicPressureKPa: 0,
        mach: 0,
        atmDensity: 0,
        externalTemperature: 0,
        atmosphericTemperature: 0,
      });
      streamFixture.store.beginFrame();
    });
  }

  function renderWidget() {
    return render(
      <streamFixture.Provider>
        <GroundSurveyComponent config={{}} id="survey" />
      </streamFixture.Provider>,
    );
  }

  it("exposes the badges slot (empty until an augment binds)", () => {
    expect(getAugmentsForSlot("ground-survey.badges")).toEqual([]);
  });

  it("renders with no augment bound (empty slot is inert)", () => {
    renderWidget();
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
    renderWidget();
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
