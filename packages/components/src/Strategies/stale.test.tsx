import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { StrategiesComponent } from "./index";

/**
 * What Strategies does when `career.status` stops being current: the roster is
 * a fact and stays, the balances stay on screen marked held and no longer arm a
 * spend. The refusal names the held balance rather than calling the career
 * short of funds.
 */

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

function newFixture() {
  return setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
}

function renderStrategies(
  fixture: StreamFixture,
  size: { w?: number; h?: number } = { w: 9, h: 12 },
) {
  const result = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "strat-stale" }}>
        <StrategiesComponent
          config={{}}
          id="strat-stale"
          w={size.w}
          h={size.h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(result.unmount);
  return result;
}

/** Comfortably affordable at the balance emitted below, so Activate arms. */
const CHEAP = {
  id: "Cheap",
  title: "Open Door Policy",
  description: "Costs very little.",
  department: "Public Relations",
  isActive: false,
  initialCostFunds: 1000,
  initialCostScience: 0,
  initialCostReputation: 0,
  canActivate: true,
  activateBlockedReason: "",
  canDeactivate: false,
  effect: "Effects: goodwill.",
};

function emitCareer(fixture: StreamFixture): void {
  act(() => {
    fixture.emit("career.status", {
      economy: { funds: 289_848, reputation: 420, science: 145 },
      facilities: null,
      contracts: null,
      strategies: { active: [], all: [CHEAP], activeCount: 0 },
      tech: null,
    });
  });
}

/** Drop the link, then advance a frame: nothing else re-samples currency. */
function goStale(fixture: StreamFixture): void {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

describe("Strategies when the career balances are no longer current", () => {
  it("shows the balances and arms Activate while the record is current", async () => {
    // The control: the assertions below would also pass on a widget that never shows a balance or enables a button.
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture);

    await waitFor(() => expect(visibleText()).toContain("289,848"));
    expect(document.querySelector("[data-held]")).toBeNull();
    const activate = screen.getByRole("button", { name: "Activate" });
    expect(activate).toBeEnabled();
    expect(activate).toHaveAttribute("title", "Set the factor, then confirm");
  });

  it("keeps the strategy roster on screen, because a strategy list cannot change while the link is down", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture);
    await waitFor(() => expect(visibleText()).toContain("289,848"));

    goStale(fixture);

    await waitFor(() =>
      expect(document.querySelector("[data-held]")).not.toBeNull(),
    );
    expect(screen.getByText("Open Door Policy")).toBeInTheDocument();
    expect(screen.getByText("Admin Building")).toBeInTheDocument();
    expect(visibleText()).not.toContain("Awaiting career data");
  });

  it("keeps each balance on the rail, marked held by Unit, with no written caption", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture);
    await waitFor(() => expect(visibleText()).toContain("289,848"));

    goStale(fixture);

    await waitFor(() =>
      expect(
        document.querySelectorAll("[data-balance-row] [data-held]"),
      ).toHaveLength(3),
    );
    const rail = document.querySelector("[data-balance-row]");
    expect(rail?.textContent).toContain("289,848");
    expect(rail?.textContent).toContain("420");
    expect(rail?.textContent).toContain("145");
    expect(visibleText()).not.toContain("not current");
  });

  it("refuses Activate with the staleness reason rather than calling the operator short of funds", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Activate" })).toBeEnabled(),
    );

    goStale(fixture);

    // Same disabled button as a short balance, but a different caption: one wants funds, the other the link.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Activate" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Activate" })).toHaveAttribute(
      "title",
      "Affordability cannot be checked against a held balance",
    );
  });

  it("draws no affordability verdict on a price while the balance is held", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture);
    await waitFor(() =>
      expect(
        document.querySelector("[data-afford]")?.getAttribute("data-afford"),
      ).toBe("yes"),
    );

    goStale(fixture);

    await waitFor(() =>
      expect(document.querySelector("[data-held]")).not.toBeNull(),
    );
    // The last balance covered the price, but a held figure can say neither yes nor no.
    expect(document.querySelector("[data-afford]")).toBeNull();
  });

  it("marks the tiny bucket's held balance, where 'unknown' would blame the wrong thing", async () => {
    // w=4 is the tiny bucket.
    const fixture = newFixture();
    renderStrategies(fixture, { w: 4, h: 4 });
    emitCareer(fixture);
    await waitFor(() => expect(visibleText()).toContain("290kf"));
    expect(document.querySelector("[data-held]")).toBeNull();

    goStale(fixture);

    await waitFor(() =>
      expect(
        document.querySelector("[data-balance-row] [data-held]"),
      ).not.toBeNull(),
    );
    expect(visibleText()).not.toContain("not current");
    // "funds unknown" is the never-arrived wording.
    expect(visibleText()).not.toContain("funds unknown");
  });

  it("says nothing about currency before anything has ever arrived", () => {
    // A cold mount is not a dropped link.
    renderStrategies(newFixture());

    expect(document.querySelector("[data-held]")).toBeNull();
  });
});
