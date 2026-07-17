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
import { act, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { type GroundSurveyBadgesContext, GroundSurveyComponent } from "./index";

// Rendered trees, tracked so afterEach can unmount them BEFORE disconnecting the
// legacy source or clearing the augment registry. RTL auto-cleanup runs after
// this file's afterEach, so it can't be relied on to unmount first —
// buffered.disconnect()/clearAugments() firing on a still-mounted widget is a
// state update outside act(), the documented anti-pattern in CLAUDE.md.
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
 * `v.body` still resolves through the legacy `MockDataSource` (the
 * `useTelemetry` mapTopic shim's fallback); altitude/heightFromTerrain now
 * stream via `vessel.flight` — see `useGroundSurveySamples`'s doc comment.
 */

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.body" },
];

describe("GroundSurvey — augment slots (spec §4)", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let streamFixture: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    clearRegistry();
    clearAugments();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
    streamFixture = setupStreamFixture({ carriedChannels: [] });
  });

  afterEach(() => {
    unmountAll();
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
    act(() => {
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
