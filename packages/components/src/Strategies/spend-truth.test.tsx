import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { StrategiesComponent } from "./index";

/**
 * What a strategy card may claim about what activating it costs. Three zero
 * stock cost fields say those three are zero and nothing more: a strategy a
 * career mod adds may be priced in a currency of its own, which the record has
 * no field for.
 */

const PROGRAM = {
  // Priced in a currency the record has no field for, so every stock cost field is zero.
  id: "SurveysHighAltitude",
  title: "High Altitude Survey",
  description: "Fly high and fast.",
  departmentName: "Surveys",
  isActive: false,
  factor: 0,
  dateActivated: 0,
  requiredReputation: 0,
  initialCostFunds: 0,
  initialCostScience: 0,
  initialCostReputation: 0,
  effectiveCostReputation: 0,
  hasFactorSlider: false,
  factorSliderDefault: 0,
  factorSliderSteps: 1,
  canActivate: true,
  activateBlockedReason: "",
  canDeactivate: false,
  deactivateBlockedReason: "Strategy is not active",
  effect: "",
};

/** A stock strategy that really does charge reputation to set up. */
const PRICED = {
  ...PROGRAM,
  id: "FundraisingCampaignCfg",
  title: "Fundraising Campaign",
  departmentName: "Finances",
  initialCostReputation: 7.3,
  effectiveCostReputation: 13.97,
};

describe("Strategies: what a card claims activating it costs", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    stream = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function renderWidget() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "s" }}>
          <StrategiesComponent config={{}} id="s" w={9} h={12} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  function emit(all: unknown[]) {
    act(() => {
      stream.emit("career.status", {
        balances: { funds: 289848, reputation: 976, science: 0 },
        facilities: null,
        contracts: null,
        strategies: { active: [], all, activeCount: 0 },
        tech: null,
      });
    });
  }

  // The control: a strategy the record can price still shows the figure and the currency.
  it("prices a strategy the record does carry a cost for", async () => {
    const { container } = renderWidget();
    emit([PRICED]);

    await screen.findByText("Fundraising Campaign");
    const text = container.textContent ?? "";
    // Reputation's own precision is one decimal, and the currency reads as the word beside the glyph.
    expect(text).toContain("14.0");
    expect(text).toContain("reputation");
  });

  it("does not call a strategy free just because the record priced none of the three", async () => {
    const { container } = renderWidget();
    emit([PROGRAM]);

    await screen.findByText("High Altitude Survey");
    expect(container.textContent).not.toContain("No setup cost");
  });

  // A card with no cost line at all reads as free just as loudly.
  it("says which currencies it read, beside the control that spends them", async () => {
    const { container } = renderWidget();
    emit([PROGRAM]);

    await screen.findByText("High Altitude Survey");
    expect(container.textContent).toContain(
      "No funds, science or rep cost on this record",
    );
  });
});
