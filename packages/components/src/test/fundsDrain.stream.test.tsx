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
 * CLAUDE.md's rule is that a widget exposing a funds-spending action shows the
 * balance in the same widget, so the operator is never sent elsewhere to find
 * out whether they can afford the thing they are about to confirm. Every widget
 * below satisfied that literally and still misled: under a career overhaul the
 * programme runs a continuous per-day cost, so a balance that covers a purchase
 * today need not cover it and the month after it, and the balance alone does
 * not say which.
 *
 * This is the same scenario put through all four in one file, because the rule
 * is deliberately duplicative (per-widget, not per-dashboard) and the failure it
 * guards against is one widget quietly not carrying what the others do.
 *
 * The two cases are the whole point and are asserted as a pair: a stock career,
 * whose economy provider answers with two honest zeros, must look exactly as it
 * did, and an overhaul career must not. Neither may render a drain of zero.
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

/**
 * Every widget under test, mounted at its registered default size against one
 * career economy, returning the text the operator can read.
 *
 * Each takes only the channels it needs to reach its funds readout. The point
 * of the test is what happens beside the balance, so no widget is fed a scenario
 * beyond the one that puts a balance on screen.
 */
async function textFor(
  widget:
    | "space-center-status"
    | "launch-director"
    | "astronaut-complex"
    | "strategies",
  economy: Record<string, unknown>,
): Promise<string> {
  const fixture = setupStreamFixture({
    carriedChannels: [
      "career.status",
      "spaceCenter.scene",
      "spaceCenter.launchSites",
      "spaceCenter.partsAvailable",
      "spaceCenter.savedShips",
      "spaceCenter.crewRoster",
      "spaceCenter.astronautComplex",
    ],
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

  if (widget === "space-center-status") {
    mount(
      widget,
      <fixture.Provider>
        <SpaceCenterStatusComponent id={widget} w={6} h={7} />
      </fixture.Provider>,
    );
  } else if (widget === "launch-director") {
    mount(
      widget,
      <fixture.Provider>
        <LaunchDirectorComponent id={widget} w={7} h={10} />
      </fixture.Provider>,
    );
  } else if (widget === "astronaut-complex") {
    mount(
      widget,
      <fixture.Provider>
        <AstronautComplexComponent id={widget} w={6} h={8} />
      </fixture.Provider>,
    );
  } else {
    mount(
      widget,
      <fixture.Provider>
        <StrategiesComponent id={widget} w={9} h={8} />
      </fixture.Provider>,
    );
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

  // The balance is the last thing to land, and it is the anchor for every
  // assertion below: reading before it arrives would let a "renders nothing"
  // case pass against a widget that had simply not rendered yet.
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
      // Stock reports zeros rather than staying silent, and a zero rate must
      // not become a "0f/day" chip: that reads as a programme that happens to
      // break even rather than one with no upkeep to break even against.
      const text = await textFor(widget, STOCK_ECONOMY);
      expect(text).not.toContain("/day");
      expect(text).not.toContain("drain");
      expect(text).not.toContain("left");
      // The balance is still there: the rule this readout serves is that a
      // spender always shows one.
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
