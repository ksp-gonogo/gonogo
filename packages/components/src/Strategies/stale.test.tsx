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
 * What Strategies does when `career.status` stops being current.
 *
 * The record splits. The strategy roster is a fact and stays on screen: nothing
 * can activate or retire a strategy down a link that is not delivering, so the
 * Administration building still offers exactly what it offered. The BALANCES are
 * withheld, because this widget does not print them, it spends them: every
 * Activate button is armed or refused by comparing a cost against them, and
 * committing 500,000f against a figure from thirty seconds ago is the whole
 * hazard.
 *
 * The assertions that earn this file are the ones about legibility. A refusal
 * captioned "Insufficient funds" tells the operator to go earn money, which is
 * both wrong and unfixable when the real fault is the link. And a blank rail is
 * already what an absent economy renders, so "not current" has to say so in
 * words rather than by showing the same three dashes.
 */

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

function newFixture() {
  return setupStreamFixture({
    carriedChannels: ["career.status"],
    pinnedUt: 10,
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
    // The control. Every assertion below would also pass on a widget that never
    // manages to show a balance or enable a button at all.
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture);

    await waitFor(() => expect(visibleText()).toContain("289,848"));
    expect(visibleText()).not.toContain("balances not current");
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
      expect(visibleText()).toContain("balances not current"),
    );
    // The fact half of the same record. Withholding the roster too would swap
    // the whole widget for "Awaiting career data...", which claims we never
    // learned what the Administration building offers.
    expect(screen.getByText("Open Door Policy")).toBeInTheDocument();
    expect(screen.getByText("Admin Building")).toBeInTheDocument();
    expect(visibleText()).not.toContain("Awaiting career data");
  });

  it("withholds the balances and says the link is why, not that the career is empty", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture);
    await waitFor(() => expect(visibleText()).toContain("289,848"));

    goStale(fixture);

    await waitFor(() =>
      expect(visibleText()).toContain("balances not current"),
    );
    // Withheld, not merely gone: a figure held past its currency is what the
    // Activate gate would then be computed from.
    expect(visibleText()).not.toContain("289,848");
    expect(visibleText()).not.toContain("420");
    expect(visibleText()).not.toContain("145");
  });

  it("refuses Activate with the staleness reason rather than calling the operator short of funds", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Activate" })).toBeEnabled(),
    );

    goStale(fixture);

    // The hero assertion. Same disabled button as a genuinely short balance,
    // deliberately NOT the same caption: one sends the operator to go earn
    // money, the other to go look at the link.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Activate" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Activate" })).toHaveAttribute(
      "title",
      "Career balances are no longer current, so affordability cannot be checked",
    );
  });

  it("says 'not current' in the tiny bucket, where 'unknown' would blame the wrong thing", async () => {
    // w=4 is the tiny bucket, whose single funds row is the only place the
    // balance-visibility rule can be honoured at that size.
    const fixture = newFixture();
    renderStrategies(fixture, { w: 4, h: 4 });
    emitCareer(fixture);
    await waitFor(() => expect(visibleText()).toContain("290kf"));

    goStale(fixture);

    await waitFor(() =>
      expect(visibleText()).toBe("Strategies0 activefunds not current"),
    );
    // "funds unknown" is the never-arrived wording and it is still reachable;
    // reaching it from here would deny having ever been told a balance.
    expect(visibleText()).not.toContain("funds unknown");
  });

  it("says nothing about currency before anything has ever arrived", () => {
    // A cold mount is not a dropped link, and conflating them accuses the link
    // on every first paint.
    renderStrategies(newFixture());

    expect(visibleText()).not.toContain("not current");
  });
});
