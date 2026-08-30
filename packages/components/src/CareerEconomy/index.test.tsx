import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CareerEconomyComponent } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

/** The three balances core has always published, with no interpretation. */
const BALANCES = { funds: 289_848, reputation: 142.6, science: 145 };

/** Stock's answer: no decay, no subsidy, no ongoing cost, and no breakdown. */
const STOCK = {
  ...BALANCES,
  economyModel: "stock",
  reputationDecayPerDay: 0,
  subsidyPerDay: 0,
  subsidyMinPerDay: 0,
  subsidyMaxPerDay: 0,
  upkeepPerDay: 0,
};

/** An overhaul's answer: reputation is income and the programme has payroll. */
const OVERHAUL = {
  ...BALANCES,
  economyModel: "rp1",
  reputationDecayPerDay: 0.0634,
  subsidyPerDay: 1_240.2,
  subsidyMinPerDay: 400,
  subsidyMaxPerDay: 3_000,
  upkeepPerDay: 980.4,
  upkeep: {
    facilities: 300,
    launchComplexes: 250.4,
    researchSalary: 180,
    training: 60,
    crewBase: 100,
    crewInFlight: 40,
    integrationSalary: 50,
  },
};

/**
 * Renders the widget against a real stream and emits one `career.status`
 * frame, or none at all when handed null. The emit lands a frame later, so
 * every caller asserts through `findBy`.
 */
function mount(economy: Record<string, unknown> | null) {
  const fixture = setupStreamFixture({
    carriedChannels: ["career.status"],
    pinnedUt: 10,
    suspendFrames: true,
  });

  const { unmount, container } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "economy" }}>
        <CareerEconomyComponent id="economy" w={6} h={9} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);

  if (economy !== null) {
    act(() => {
      fixture.emit("career.status", {
        economy,
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });
  }

  return { container, fixture };
}

describe("CareerEconomy", () => {
  it("shows the two balances the interpretation qualifies", async () => {
    mount(OVERHAUL);

    expect((await screen.findByText("289,848")).textContent).toBe(
      "289,848f funds",
    );
    expect(screen.getByText("142.6").textContent).toBe("142.6 reputation");

    await act(async () => {});
  });

  /**
   * The stock regression. Stock genuinely models none of this, so the widget
   * must say so in words rather than draw a ledger of zeros: a zero subsidy
   * beside a zero upkeep reads as a programme that happens to break even,
   * which is a claim about a mechanism stock does not have.
   */
  it("says stock's money does nothing rather than showing a ledger of zeros", async () => {
    mount(STOCK);

    expect(
      await screen.findByText(
        /money does not decay, earns no subsidy and costs nothing to hold/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Subsidy")).not.toBeInTheDocument();
    expect(screen.queryByText("Upkeep")).not.toBeInTheDocument();
    expect(screen.queryByText("Where the upkeep goes")).not.toBeInTheDocument();

    await act(async () => {});
  });

  it("renders the rates and the per-source upkeep when a model reports them", async () => {
    mount(OVERHAUL);

    expect(await screen.findByText("Reputation decay")).toBeInTheDocument();
    expect(screen.getByText("Subsidy")).toBeInTheDocument();
    expect(screen.getByText("Upkeep")).toBeInTheDocument();
    expect(screen.getByText("Where the upkeep goes")).toBeInTheDocument();
    expect(screen.getByText("Launch complexes")).toBeInTheDocument();
    expect(screen.getByText("Integration")).toBeInTheDocument();

    await act(async () => {});
  });

  it("shows the modified breakdown, which is the one that decomposes the total", async () => {
    // 300 + 250.4 + 180 + 60 + 100 + 40 + 50 = 980.4, the upkeep beside it. The
    // unmodified figures are on the same frame and higher, so a widget reading
    // the wrong one shows a list that does not add up to the total above it,
    // which is the disagreement the two fields exist to stop.
    mount({
      ...OVERHAUL,
      upkeepBeforeModifiers: { ...OVERHAUL.upkeep, researchSalary: 240 },
    });

    expect(
      await screen.findByText("Where the upkeep goes"),
    ).toBeInTheDocument();
    expect(screen.getByText("180.0")).toBeInTheDocument();
    expect(screen.queryByText("240.0")).not.toBeInTheDocument();

    await act(async () => {});
  });

  it("labels the breakdown as pre-discount when only the unmodified one arrived", async () => {
    // A model that can state its costs but not price them. Rendering these under
    // the plain heading would put a list beside a total it does not sum to, with
    // nothing to say which of the two was the odd one out.
    const { upkeep, ...withoutModified } = OVERHAUL;
    mount({ ...withoutModified, upkeepBeforeModifiers: upkeep });

    expect(
      await screen.findByText("Where the upkeep goes, before discounts"),
    ).toBeInTheDocument();
    expect(screen.getByText("Launch complexes")).toBeInTheDocument();

    await act(async () => {});
  });

  it("names the net gain rather than signing it", async () => {
    // 1240.2 in, 980.4 out. The direction is the whole point of the row, and a
    // leading minus is read as a formatting artefact too often to carry it.
    mount(OVERHAUL);

    expect(await screen.findByText("Net gain")).toBeInTheDocument();

    await act(async () => {});
  });

  it("names a net drain when the upkeep outruns the subsidy", async () => {
    mount({ ...OVERHAUL, subsidyPerDay: 100 });

    expect(await screen.findByText("Net drain")).toBeInTheDocument();

    await act(async () => {});
  });

  it("withholds the net when only one of the two rates arrived", async () => {
    // Treating an absent subsidy as zero would report a drain no model claimed.
    mount({ ...BALANCES, economyModel: "partial", upkeepPerDay: 980.4 });

    expect(await screen.findByText("Upkeep")).toBeInTheDocument();
    expect(screen.queryByText("Net gain")).not.toBeInTheDocument();
    expect(screen.queryByText("Net drain")).not.toBeInTheDocument();

    await act(async () => {});
  });

  it("omits a source the model does not break out rather than showing it as zero", async () => {
    mount({ ...OVERHAUL, upkeep: { launchComplexes: 250.4 } });

    expect(await screen.findByText("Launch complexes")).toBeInTheDocument();
    expect(screen.queryByText("Training")).not.toBeInTheDocument();
    expect(screen.queryByText("Crew")).not.toBeInTheDocument();

    await act(async () => {});
  });

  it("says nothing has arrived rather than showing an empty programme", async () => {
    mount(null);

    expect(
      await screen.findByText(/no career economy has arrived/i),
    ).toBeInTheDocument();

    await act(async () => {});
  });

  it("has no a11y violations", async () => {
    const { container } = mount(OVERHAUL);
    await screen.findByText("Where the upkeep goes");

    await expectNoA11yViolations(container);

    await act(async () => {});
  });
});
