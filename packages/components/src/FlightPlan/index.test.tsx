import { DashboardItemContext } from "@ksp-gonogo/core";
import { TelemetryOverlayProvider } from "@ksp-gonogo/sitrep-sdk/spine";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { emitAt, KERBIN } from "../test/bodyEmits";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FlightPlanComponent } from "./index";
import type { FlightPlan } from "./plan";
import { savePlan } from "./planStore";

const plan: FlightPlan = {
  id: "mun-east",
  name: "Mun landing, east",
  reserve: 0.1,
  steps: [
    { id: "s1", kind: "launch", inputs: { heading: 90 }, intents: [] },
    {
      id: "s2",
      kind: "reach-orbit",
      inputs: { body: "Kerbin", periapsis: 80_000 },
      needsDv: 3_400,
      intents: [
        {
          group: 2,
          label: "Jettison fairing",
          trigger: {
            kind: "value",
            quantity: "altitude",
            op: ">=",
            value: 55_000,
          },
        },
      ],
    },
    {
      id: "s3",
      kind: "transfer",
      inputs: { to: "Mun" },
      needsDv: 860,
      intents: [],
    },
    {
      id: "s4",
      kind: "land",
      inputs: { on: "Mun" },
      needsDv: 890,
      intents: [],
    },
  ],
};

function emitFlight(
  fixture: ReturnType<typeof setupStreamFixture>,
  altitude: number,
  dvLeft: number,
  ag2: boolean,
) {
  emitAt(fixture, KERBIN);
  fixture.emit("vessel.flight", {
    latitude: 0,
    longitude: 0,
    altitudeAsl: altitude,
    altitudeTerrain: altitude,
    verticalSpeed: 0,
    surfaceSpeed: 0,
    orbitalSpeed: 0,
    gForce: 1,
    dynamicPressureKPa: 0,
    mach: 0,
    atmDensity: 0,
    externalTemperature: 250,
    atmosphericTemperature: 250,
  });
  fixture.emit("vessel.control", {
    actionGroups: [
      { index: 1, name: "AG1", state: false },
      { index: 2, name: "AG2", state: ag2 },
    ],
  });
  fixture.emit("dv.summary", {
    stageCount: 3,
    totalDvVac: dvLeft,
    totalDvAsl: dvLeft,
    totalDvActual: dvLeft,
  });
}

function renderPlan(
  fixture: ReturnType<typeof setupStreamFixture>,
  h = 12,
  planId = plan.id,
) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "plan-test" }}>
        <FlightPlanComponent config={{ planId }} id="plan-test" h={h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

describe("FlightPlanComponent", () => {
  it("says no plan is applied when the tile names none", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 112, suspendFrames: true });
    renderPlan(fixture, 12, "never-saved");
    await waitFor(() => expect(visibleText()).toContain("No plan applied"));
  });

  it("shows each step with its intents, and the plan's state", async () => {
    savePlan(plan);
    const fixture = setupStreamFixture({ pinnedUt: 112, suspendFrames: true });
    const { container } = renderPlan(fixture);
    act(() => emitFlight(fixture, 41_600, 5_620, false));
    await waitFor(() => expect(visibleText()).toContain("Reach orbit"));
    const text = visibleText();
    expect(text).toContain("Jettison fairing");
    expect(text).toContain("≥ 55.0 km");
    expect(text).toContain("41.6 km");
    await expectNoA11yViolations(container);
  });

  it("flags the step whose action group has not fired past its trigger", async () => {
    savePlan(plan);
    const fixture = setupStreamFixture({ pinnedUt: 151, suspendFrames: true });
    const { container } = renderPlan(fixture);
    act(() => emitFlight(fixture, 58_300, 5_620, false));
    await waitFor(() => expect(visibleText()).toContain("Off plan"));
    expect(container.querySelector("[data-flagged]")?.textContent).toContain(
      "Reach orbit",
    );
  });

  it("names the first step the Δv left cannot reach", async () => {
    savePlan(plan);
    const fixture = setupStreamFixture({ pinnedUt: 112, suspendFrames: true });
    renderPlan(fixture);
    act(() => emitFlight(fixture, 41_600, 2_000, false));
    await waitFor(() => expect(visibleText()).toContain("Fails at step 3"));
  });

  it("keeps the step and the margin in its small form", async () => {
    savePlan(plan);
    const fixture = setupStreamFixture({ pinnedUt: 112, suspendFrames: true });
    renderPlan(fixture, 5);
    act(() => emitFlight(fixture, 41_600, 5_620, false));
    await waitFor(() => expect(visibleText()).toContain("2 of 4"));
    expect(visibleText()).toContain("Δv margin");
  });

  it("follows the predicted run under the cursor in design mode, with no tag of its own", async () => {
    savePlan(plan);
    const live = setupStreamFixture({ pinnedUt: 112, suspendFrames: true });
    const design = setupStreamFixture({ pinnedUt: 112, suspendFrames: true });
    render(
      <live.Provider>
        <design.Provider>
          <span />
        </design.Provider>
        <TelemetryOverlayProvider
          overlay={{
            mode: "design",
            topics: ["vessel", "dv"],
            client: design.client,
            store: design.store,
          }}
        >
          <DashboardItemContext.Provider value={{ instanceId: "plan-design" }}>
            <FlightPlanComponent
              config={{ planId: plan.id }}
              id="plan-design"
              h={12}
            />
          </DashboardItemContext.Provider>
        </TelemetryOverlayProvider>
      </live.Provider>,
    );
    act(() => emitFlight(design, 41_600, 5_620, false));
    await waitFor(() => expect(visibleText()).toContain("Reach orbit"));
    expect(visibleText()).not.toContain("Predicted");
    expect(visibleText()).toContain("41.6 km");
    expect(visibleText()).toContain("5620 m/s");
  });
});
