import {
  clearActionHandlers,
  DashboardItemContext,
  PerfBudget,
} from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";
import { wideTileForTests } from "./wideTile";

wideTileForTests();

afterEach(() => {
  clearActionHandlers();
});

const NOW = 1_000_000;

const KERBIN_SYSTEM = [
  {
    index: 0,
    name: "Kerbol",
    parentIndex: null,
    radius: 261_600_000,
    gravParameter: 1.1723328e18,
    sphereOfInfluence: null,
    orbit: null,
  },
  {
    index: 1,
    name: "Kerbin",
    parentIndex: 0,
    radius: 600_000,
    gravParameter: 3.5316e12,
    sphereOfInfluence: 84_159_286,
    orbit: {
      sma: 13_599_840_256,
      ecc: 0,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 3.14,
      epoch: 0,
    },
  },
  {
    index: 2,
    name: "Mun",
    parentIndex: 1,
    radius: 200_000,
    gravParameter: 6.5138398e10,
    sphereOfInfluence: 2_429_559,
    orbit: {
      sma: 12_000_000,
      ecc: 0,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 1.7,
      epoch: 0,
    },
  },
  {
    index: 3,
    name: "Minmus",
    parentIndex: 1,
    radius: 60_000,
    gravParameter: 1.7658e9,
    sphereOfInfluence: 2_247_428,
    orbit: {
      sma: 47_000_000,
      ecc: 0,
      inc: 6,
      lan: 78,
      argPe: 38,
      meanAnomalyAtEpoch: 0.9,
      epoch: 0,
    },
  },
  {
    index: 4,
    name: "Duna",
    parentIndex: 0,
    radius: 320_000,
    gravParameter: 3.0136321e11,
    sphereOfInfluence: 47_921_949,
    orbit: {
      sma: 20_726_155_264,
      ecc: 0.051,
      inc: 0.06,
      lan: 135.5,
      argPe: 0,
      meanAnomalyAtEpoch: 3.14,
      epoch: 0,
    },
  },
];

function mount(orbit: Record<string, number> = {}) {
  const fixture = setupStreamFixture({ pinnedUt: NOW, suspendFrames: true });
  const commandHandler = vi.fn(() => ({ ok: true }));
  fixture.transport.setCommandHandler(commandHandler);
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mnv-transfer" }}>
        <ManeuverPlannerComponent id="mnv-transfer" config={{}} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("trackingStation.bodies", { bodies: KERBIN_SYSTEM });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma: 700_000,
      ecc: 0,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0.4,
      epoch: NOW,
      mu: 3.5316e12,
      ...orbit,
      horizon: ANALYTIC_UNBOUNDED_HORIZON,
    });
  });
  return { fixture, commandHandler };
}

async function pickBody(name: string) {
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Maneuver preset" }),
    "transfer-to-body",
  );
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Transfer body" }),
    name,
  );
  return user;
}

describe("ManeuverPlanner's body transfer solve", () => {
  it("is not run again on every frame the view clock moves", async () => {
    const budget = PerfBudget.getAll().find((b) =>
      b.name.startsWith("Body transfer Lambert"),
    );
    if (!budget) throw new Error("the body transfer budget is not registered");
    const { fixture } = mount();
    await pickBody("Mun");
    await act(async () => {});
    budget.reset();
    for (let i = 1; i <= 60; i++) {
      act(() => {
        fixture.wall.advanceBy(1 / 60);
        fixture.scrubTo(NOW + i / 60);
      });
    }
    // A Mun plan is about 730 solves, and the held second can turn over once or twice in a second of frames.
    expect(budget.windowTotal()).toBeGreaterThan(0);
    expect(budget.windowTotal()).toBeLessThanOrEqual(1500);
  });
});
