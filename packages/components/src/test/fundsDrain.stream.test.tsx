import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AstronautComplexComponent } from "../AstronautComplex";
import { LaunchDirectorComponent } from "../LaunchDirector";
import { SpaceCenterStatusComponent } from "../SpaceCenterStatus";
import { StrategiesComponent } from "../Strategies";
import { setupStreamFixture } from "./setupStreamFixture";

/**
 * A widget with a funds-spending action shows the balance beside it, and
 * under a career overhaul a balance alone misleads: the programme runs a
 * continuous per-day cost. The same scenario goes through all four widgets,
 * since the rule is per widget. A stock career (two honest zeros) must look
 * as it did, an overhaul career must not, and neither may render a zero drain.
 */
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

/** Stock career's truthful answer: the mechanism does not exist. */
const STOCK_ECONOMY = {
  funds: 289848,
  reputation: 200,
  science: 100,
  economyModel: "stock",
  reputationDecayPerDay: 0,
  subsidyPerDay: 0,
  upkeepPerDay: 0,
};

/** An overhauled career: a subsidy that does not cover the standing cost. */
const OVERHAUL_ECONOMY = {
  funds: 289848,
  reputation: 200,
  science: 100,
  economyModel: "rp-1",
  reputationDecayPerDay: -0.4,
  subsidyPerDay: 1200,
  upkeepPerDay: 2180,
  upkeep: {
    facilities: 640,
    launchComplexes: 810,
    researchSalary: 420,
    integrationSalary: 310,
  },
};

function mount(id: string, ui: ReactElement) {
  const { unmount } = render(
    <DashboardItemContext.Provider value={{ instanceId: id }}>
      {ui}
    </DashboardItemContext.Provider>,
  );
  renderedTrees.push(unmount);
}

/** Every widget under test at its default size against one career economy, fed only what puts a balance on screen. */
async function textFor(
  widget:
    | "space-center-status"
    | "launch-director"
    | "astronaut-complex"
    | "strategies",
  economy: Record<string, unknown>,
): Promise<string> {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });

  const career = {
    economy,
    facilities: null,
    contracts: null,
    strategies: { active: [], all: [], activeCount: 0 },
    tech: null,
  };

  switch (widget) {
    case "space-center-status":
      mount(
        widget,
        <fixture.Provider>
          <SpaceCenterStatusComponent id={widget} w={6} h={7} />
        </fixture.Provider>,
      );
      break;
    case "launch-director":
      mount(
        widget,
        <fixture.Provider>
          <LaunchDirectorComponent id={widget} w={7} h={10} />
        </fixture.Provider>,
      );
      break;
    case "astronaut-complex":
      mount(
        widget,
        <fixture.Provider>
          <AstronautComplexComponent id={widget} w={6} h={8} />
        </fixture.Provider>,
      );
      break;
    default:
      mount(
        widget,
        <fixture.Provider>
          <StrategiesComponent id={widget} w={9} h={8} />
        </fixture.Provider>,
      );
      break;
  }

  await act(async () => {
    fixture.emit("spaceCenter.scene", {
      scene: "SpaceCenter",
      launchSite: "LaunchPad",
    });
    fixture.emit("spaceCenter.launchSites", []);
    fixture.emit("spaceCenter.partsAvailable", { count: 214 });
    fixture.emit("spaceCenter.savedShips", []);
    fixture.emit("spaceCenter.crewRoster", []);
    fixture.emit("spaceCenter.astronautComplex", {
      applicants: [],
      activeCrew: 3,
      crewCapacity: 12,
      nextHireCost: 24000,
    });
    fixture.emit("career.status", career);
  });

  // The balance lands last; reading before it would let a "renders nothing" case pass.
  await waitFor(() => expect(visibleText()).toContain("289,848f"));
  return visibleText();
}

const WIDGETS = [
  "space-center-status",
  "launch-director",
  "astronaut-complex",
  "strategies",
] as const;

describe("every funds-spending widget reports the standing drain beside the balance", () => {
  for (const widget of WIDGETS) {
    it(`${widget}: names the drain and how long the balance covers it`, async () => {
      const text = await textFor(widget, OVERHAUL_ECONOMY);
      // 289,848 funds against a net 980 a day.
      expect(text).toContain("980.0 f/day drain");
      expect(text).toContain("295d left");
    });

    it(`${widget}: says nothing at all when the career has no such mechanism`, async () => {
      // A zero rate must not become a "0f/day" chip, which reads as breaking even against an upkeep that does not exist.
      const text = await textFor(widget, STOCK_ECONOMY);
      expect(text).not.toContain("/day");
      expect(text).not.toContain("drain");
      expect(text).not.toContain("left");
      // A spender always shows its balance.
      expect(text).toContain("289,848f");
    });

    it(`${widget}: says nothing when no economy model answered`, async () => {
      const text = await textFor(widget, {
        funds: 289848,
        reputation: 200,
        science: 100,
      });
      expect(text).not.toContain("/day");
      expect(text).not.toContain("drain");
      expect(text).toContain("289,848f");
    });
  }
});
