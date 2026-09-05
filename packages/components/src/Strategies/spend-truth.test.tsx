import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { StrategiesComponent } from "./index";

/**
 * What a strategy card may claim about what activating it costs.
 *
 * <para>The card prices a strategy from the three figures the stock record
 * carries: `initialCostFunds`, `initialCostScience`, `initialCostReputation`.
 * When all three are zero it said "No setup cost", which reads as free, and on
 * a stock career it is: the triple IS the whole price of a stock strategy.</para>
 *
 * <para>It is not the whole price under RP-1, and that is the shipped case. A
 * Program is a strategy on this same list and `Program.Accept()` charges
 * `confidenceCosts[speed]` in CONFIDENCE, a currency the stock record has no
 * field for, so the triple comes through as three zeros and the card announced
 * a 300-Confidence commitment as costing nothing. The RP-1 section directly
 * below it on the same screen was reading "300 at Normal speed, SHORT" at the
 * same moment.</para>
 *
 * <para>The fix is not to teach this widget about Confidence, which is a
 * currency it cannot read and has no channel for. It is to stop the card
 * asserting more than it read: three zeros mean those three are zero, and
 * nothing about a currency that is not on the record.</para>
 */

const PROGRAM = {
  /* An RP-1 Program, as `career.status.strategies.all` carries one. Priced in
     Confidence, which is why every stock cost field is zero. */
  id: "EarlyXPlanes",
  title: "Early X-Planes",
  description: "Fly high and fast.",
  departmentName: "Programs",
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
  let cmdFixture: MockDataSourceFixture;
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    cmdFixture = await setupMockDataSource({ keys: [] });
    stream = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    teardownMockDataSource(cmdFixture);
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
        economy: { funds: 289848, reputation: 976, science: 0 },
        facilities: null,
        contracts: null,
        strategies: { active: [], all, activeCount: 0 },
        tech: null,
      });
    });
  }

  /**
   * The control, and the half that must not change: a strategy the record CAN
   * price still shows the figure and the currency.
   */
  it("prices a strategy the record does carry a cost for", async () => {
    const { container } = renderWidget();
    emit([PRICED]);

    await screen.findByText("Fundraising Campaign");
    const text = container.textContent ?? "";
    // 13.97 rendered at reputation's own precision, which is one decimal: the
    // chip goes through `Unit` now, so the figure is rounded by the unit model
    // rather than by a formatter this widget carried. The currency comes back
    // as the spoken word beside the star glyph.
    expect(text).toContain("14.0");
    expect(text).toContain("reputation");
  });

  /**
   * The falsehood. Every stock cost field is zero because the price is in a
   * currency this record has no field for, and "No setup cost" turns that
   * silence into a claim that the commitment is free.
   */
  it("does not call a strategy free just because the record priced none of the three", async () => {
    const { container } = renderWidget();
    emit([PROGRAM]);

    await screen.findByText("Early X-Planes");
    expect(container.textContent).not.toContain("No setup cost");
  });

  /**
   * And says what it actually read, rather than nothing. A card with no cost
   * line at all reads as free just as loudly, and the operator cannot tell it
   * from a card whose figures had not arrived.
   */
  it("says which currencies it read, beside the control that spends them", async () => {
    const { container } = renderWidget();
    emit([PROGRAM]);

    await screen.findByText("Early X-Planes");
    expect(container.textContent).toContain(
      "No funds, science or rep cost on this record",
    );
  });
});
