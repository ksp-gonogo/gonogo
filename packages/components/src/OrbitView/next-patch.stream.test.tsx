import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ManeuverPlannerComponent } from "../ManeuverPlanner/index";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/** After the sphere-of-influence change that ends the observed patch, the next patch the sample already carries stands in until the game's own sample for it arrives. */

const BODIES = [
  {
    index: 1,
    name: "Kerbin",
    gravParameter: 3.5316e12,
    radius: 600_000,
    sphereOfInfluence: 84_159_286,
    atmosphere: { depth: 70_000, hasOxygen: true, seaLevelPressure: 101.3 },
  },
  {
    index: 2,
    name: "Mun",
    gravParameter: 6.5138e10,
    radius: 200_000,
    sphereOfInfluence: 2_429_559,
    atmosphere: null,
  },
];

const TRANSITION = 1000;

const KERBIN_PATCH = {
  referenceBody: "Kerbin",
  referenceBodyIndex: 1,
  sma: 13_000_000,
  ecc: 0.32,
  inc: 0.6,
  lan: 10,
  argPe: 20,
  meanAnomalyAtEpoch: 0.5,
  epoch: TRANSITION,
  startUt: TRANSITION,
  endUt: null,
  mu: 3.5316e12,
};

function munOrbit(patches: unknown[]) {
  return {
    referenceBodyIndex: 2,
    sma: -2_000_000,
    ecc: 1.7,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 900,
    mu: 6.5138e10,
    horizon: ANALYTIC_UNBOUNDED_HORIZON,
    encounter: { transitionType: 2, transitionUt: TRANSITION },
    patches: [
      {
        ...KERBIN_PATCH,
        referenceBody: "Mun",
        referenceBodyIndex: 2,
        startUt: 900,
      },
      ...patches,
    ],
  };
}

function mount(view: "orbit" | "planner", patches: unknown[], ut: number) {
  const fixture = setupStreamFixture({ pinnedUt: ut, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "np" }}>
        {view === "orbit" ? (
          <OrbitViewComponent id="np" w={9} h={18} />
        ) : (
          <ManeuverPlannerComponent id="np" config={{}} />
        )}
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("trackingStation.bodies", { bodies: BODIES });
    fixture.emit("vessel.identity", {
      vesselId: "np-vessel",
      name: "Test Vessel",
      vesselType: 0,
      situation: 5,
      parentBodyIndex: 2,
    });
    fixture.emit("vessel.orbit", munOrbit(patches), {
      quality: Quality.OnRails,
    });
  });
  return fixture;
}

describe("a craft past the sphere-of-influence change that ends its observed patch", () => {
  it("Orbit View names the next body and draws its orbit with no empty sentence", () => {
    mount("orbit", [KERBIN_PATCH], TRANSITION + 5);

    expect(screen.getByText("Kerbin")).toBeInTheDocument();
    expect(screen.queryByText("Mun")).toBeNull();
    expect(screen.queryByText("No orbital data")).toBeNull();
    expect(screen.getAllByText("Pe").length).toBeGreaterThan(0);
  });

  it("Maneuver Planner plans on the next body's orbit rather than waiting", () => {
    mount("planner", [KERBIN_PATCH], TRANSITION + 5);

    expect(screen.queryByText("Awaiting orbit telemetry")).toBeNull();
    expect(screen.queryByText("Hyperbolic trajectory")).toBeNull();
  });

  it("keeps the old patch before the change", () => {
    mount("orbit", [KERBIN_PATCH], TRANSITION - 50);

    expect(screen.getByText("Mun")).toBeInTheDocument();
  });

  it("still withholds the orbit when the sample carries no next patch", () => {
    mount("orbit", [], TRANSITION + 5);

    expect(screen.getByText("No orbital data")).toBeInTheDocument();
  });
});
