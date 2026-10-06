import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, within } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { StrategiesComponent } from "./index";

const BASE = {
  description: "A blurb.",
  factor: 0.05,
  dateActivated: 0,
  requiredReputation: 0,
  initialCostFunds: 0,
  initialCostScience: 0,
  initialCostReputation: 0,
  effectiveCostReputation: 0,
  hasFactorSlider: false,
  factorSliderDefault: 0.05,
  factorSliderSteps: 1,
  canDeactivate: false,
  deactivateBlockedReason: "",
  effect: "<b>* -1.5% Funds Off on Launch Costs.</b>\n",
};

const ACTIVE = {
  ...BASE,
  id: "active",
  title: "Aggressive Negotiations",
  departmentName: "Operations",
  isActive: true,
  canActivate: false,
  activateBlockedReason: "",
  canDeactivate: true,
};

const OPEN = {
  ...BASE,
  id: "open",
  title: "Open Source",
  departmentName: "Science",
  isActive: false,
  initialCostFunds: 12000,
  canActivate: true,
  activateBlockedReason: "",
};

const LOCKED = {
  ...BASE,
  id: "locked",
  title: "Patriotism Drive",
  departmentName: "Public Relations",
  isActive: false,
  canActivate: false,
  activateBlockedReason:
    "Requires more reputation than the program has earned.",
};

describe("Strategies short form", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    stream = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  });

  async function renderShort(h: number) {
    const view = render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "s" }}>
          <StrategiesComponent config={{}} id="s" w={5} h={h} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
    const all = [ACTIVE, OPEN, LOCKED];
    act(() => {
      stream.emit("career.status", {
        balances: { funds: 289848, reputation: 976, science: 12 },
        facilities: null,
        contracts: null,
        strategies: { active: [ACTIVE], all, activeCount: 1 },
        tech: null,
      });
    });
    await screen.findByText("Open Source");
    return view;
  }

  it("draws one line per strategy with its state and its one action, and no Active or Available sections", async () => {
    await renderShort(5);
    expect(screen.queryByRole("region", { name: "Available" })).toBeNull();
    expect(screen.getByText("LOCKED")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Deactivate$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Activate$/ }),
    ).toBeInTheDocument();
    // The effects wait behind the name.
    expect(screen.queryByText(/Funds Off on Launch Costs/)).toBeNull();
  });

  it("opens a strategy's effects when its name is pressed", async () => {
    const user = userEvent.setup();
    await renderShort(5);
    const row = screen.getByText("Aggressive Negotiations").closest("li");
    if (row === null) throw new Error("no row");
    await user.click(
      within(row).getByRole("button", { name: "Aggressive Negotiations" }),
    );
    expect(
      within(row).getByText(/Funds Off on Launch Costs/),
    ).toBeInTheDocument();
  });

  it("keeps the full cards from 7 rows up", async () => {
    await renderShort(9);
    expect(
      screen.getByRole("region", { name: "Available" }),
    ).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = await renderShort(5);
    await expectNoA11yViolations(container);
  });
});
