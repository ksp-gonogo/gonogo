import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { StrategiesComponent } from "./index";

/**
 * Characterisation: what Strategies DOES today when its telemetry reads are
 * `undefined`, recorded ahead of `useTelemetry` returning a `Reading`.
 *
 * One read, four fields off it: `career.status` supplies `strategies.all` plus
 * `economy.{funds,reputation,science}`. Two absence gates matter.
 *
 * - `if (strategies === null)` swaps the entire widget for a placeholder, and
 *   `parseStrategies` maps both `undefined` and `null` to that same `null`
 * - `overBudget` does `(balance ?? Number.POSITIVE_INFINITY) < cost`, so a
 *   balance nobody has told us yet is treated as UNLIMITED and the Activate
 *   button on a strategy the operator cannot afford is left enabled
 *
 * The second one is a fail-open. It is pinned here as observed behaviour.
 */

// Unmount before clearing the action-handler registry: clearing against a live
// tree is a state update outside act(), and RTL auto-cleanup runs too late.
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
    suspendFrames: true,
  });
}

function renderStrategies(
  fixture: StreamFixture,
  size: { w?: number; h?: number } = { w: 9, h: 12 },
) {
  const result = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "strat-char" }}>
        <StrategiesComponent
          config={{}}
          id="strat-char"
          w={size.w}
          h={size.h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(result.unmount);
  return result;
}

/** An affordable-only-if-you-know-your-balance strategy. */
const EXPENSIVE = {
  id: "Expensive",
  title: "Expensive Gamble",
  description: "Costs a fortune.",
  department: "Finance",
  isActive: false,
  initialCostFunds: 500_000,
  initialCostScience: 0,
  initialCostReputation: 0,
  canActivate: true,
  activateBlockedReason: "",
  canDeactivate: false,
  effect: "Effects: everything.",
};

function emitCareer(fixture: StreamFixture, over: Record<string, unknown>) {
  act(() => {
    fixture.emit("career.status", {
      economy: null,
      facilities: null,
      contracts: null,
      strategies: null,
      tech: null,
      ...over,
    });
  });
}

describe("Strategies: nothing has arrived at all", () => {
  it("swaps the whole widget for a placeholder, under a DIFFERENT panel title from the loaded one", () => {
    renderStrategies(newFixture());

    // `parseStrategies(undefined) === null` reaches the early return, which
    // renders a panel titled "Strategies". The loaded widget is titled
    // "Admin Building", so the title itself is an observable of this gate.
    expect(screen.getByText("Strategies")).toBeInTheDocument();
    expect(screen.getByText(/Awaiting career data\.\.\./)).toBeInTheDocument();
    expect(screen.queryByText("Admin Building")).toBeNull();
    // None of the loaded chrome exists: no sections, no funds tally, no
    // Activate control.
    expect(screen.queryByLabelText("Active")).toBeNull();
    expect(screen.queryByLabelText("Available")).toBeNull();
    expect(screen.queryByRole("button", { name: "Activate" })).toBeNull();
    // The loaded header always renders three balance tallies (dashed when the
    // figures are missing); none of them exist on this branch.
    expect(screen.queryAllByText(NULL_DISPLAY)).toHaveLength(0);
    expect(visibleText()).toBe("StrategiesAwaiting career data...");
  });

  it("says nothing at all in a short box, because the placeholder is itself gated on height", () => {
    // `showSubtitle` is `(h ?? 8) >= 4`, so at h=3 the awaiting branch renders
    // an empty panel body: the widget is silent rather than saying it waits.
    renderStrategies(newFixture(), { w: 9, h: 3 });

    expect(screen.getByText("Strategies")).toBeInTheDocument();
    expect(screen.queryByText(/Awaiting career data/)).toBeNull();
  });
});

describe("Strategies: the `strategies === null` absence gate", () => {
  it("fires for a never-arrived topic and stops firing for a confirmed-empty list", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);

    expect(screen.getByText(/Awaiting career data/)).toBeInTheDocument();

    emitCareer(fixture, {
      economy: { funds: 1000, reputation: 5, science: 20 },
      strategies: { active: [], all: [], activeCount: 0 },
    });

    // An empty array parses to `[]`, not `null`: the gate stops firing, the
    // title changes, and the widget states "none available" with confidence.
    await waitFor(() =>
      expect(screen.getByText("Admin Building")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Awaiting career data/)).toBeNull();
    expect(
      screen.getByText(/No strategies available right now/),
    ).toBeInTheDocument();
  });

  it("fires for a partial payload whose `strategies` field is null", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);

    // The record arrived, carrying economy but not strategies. Today that is
    // indistinguishable from the topic never having arrived.
    emitCareer(fixture, {
      economy: { funds: 289_848, reputation: 420, science: 145 },
      strategies: null,
    });

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("career.status")).toBe(true),
    );
    expect(screen.getByText(/Awaiting career data/)).toBeInTheDocument();
    // The funds the payload DID carry are thrown away with the rest, even
    // though this widget is required to keep a balance on screen.
    expect(visibleText()).not.toContain("289,848");
  });

  it("fires when `strategies.all` itself is null", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);

    emitCareer(fixture, {
      strategies: { active: [], all: null, activeCount: 0 },
    });

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("career.status")).toBe(true),
    );
    expect(screen.getByText(/Awaiting career data/)).toBeInTheDocument();
  });
});

describe("Strategies: null versus undefined", () => {
  it("does NOT distinguish a whole-topic tombstone from a topic that never arrived", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);

    act(() => {
      // The hook returns `null` for a tombstone rather than `undefined`, so the
      // widget could tell them apart. `null?.strategies?.all` is `undefined`
      // and `parseStrategies` folds both into the same placeholder.
      fixture.emit("career.status", null);
    });

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("career.status")).toBe(true),
    );
    expect(screen.getByText(/Awaiting career data/)).toBeInTheDocument();
  });
});

describe("Strategies: an absent balance beside a present strategy list", () => {
  it("renders the funds/rep/science tallies as the null dash", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);

    emitCareer(fixture, {
      economy: null,
      strategies: { active: [], all: [EXPENSIVE], activeCount: 0 },
    });

    await waitFor(() =>
      expect(screen.getByText("Expensive Gamble")).toBeInTheDocument(),
    );
    // `formatNumber(funds?.magnitude)` returns NULL_DISPLAY for all three, so
    // the header rail reads as dashes rather than dropping the balances.
    const dashes = screen.getAllByText(NULL_DISPLAY);
    expect(dashes).toHaveLength(3);
    expect(dashes[0]?.parentElement?.textContent).toBe(
      `0 active·${NULL_DISPLAY}f funds·${NULL_DISPLAY} reputation·${NULL_DISPLAY} science`,
    );
  });

  /**
   * Recorded prior behaviour: "FAIL-OPEN: leaves Activate enabled on a 500,000f
   * strategy while the balance is unknown". `overBudget` was
   * `(balance ?? Number.POSITIVE_INFINITY) < cost`, so an absent balance read as
   * unlimited money on a control that commits career funds.
   */
  it("withholds Activate on a 500,000f strategy while the balance is unknown", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);

    emitCareer(fixture, {
      economy: null,
      strategies: { active: [], all: [EXPENSIVE], activeCount: 0 },
    });

    await waitFor(() =>
      expect(screen.getByText("Expensive Gamble")).toBeInTheDocument(),
    );
    // An unknown balance cannot cover the cost, and it reads through the same
    // tooltip a genuinely short balance produces.
    const activate = screen.getByRole("button", { name: "Activate" });
    expect(activate).toBeDisabled();
    expect(activate).toHaveAttribute(
      "title",
      "Insufficient funds / science / reputation at this factor",
    );
  });

  it("disables the same button once a balance actually arrives and is too small", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);

    emitCareer(fixture, {
      economy: { funds: 10, reputation: 0, science: 0 },
      strategies: { active: [], all: [EXPENSIVE], activeCount: 0 },
    });

    // The other side of the same gate, proving the test above records an
    // absence rather than a button that is always enabled.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Activate" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Activate" })).toHaveAttribute(
      "title",
      "Insufficient funds / science / reputation at this factor",
    );
  });
});

describe("Strategies: tiny mode keeps the balance row", () => {
  /**
   * Recorded prior behaviour: "omits the funds row while economy is absent". The
   * tiny bucket dropped the row entirely, not even a dash, at the same moment
   * the Activate buttons went fail-open on that missing balance.
   */
  it("says the funds balance is unknown while economy is absent, and shows it once funds arrive", async () => {
    const fixture = newFixture();
    // w=4 lands in the `tiny` bucket (TINY_W is 5).
    renderStrategies(fixture, { w: 4, h: 4 });

    emitCareer(fixture, {
      economy: null,
      strategies: { active: [], all: [EXPENSIVE], activeCount: 0 },
    });

    // The tiny panel keeps the "Strategies" title the awaiting branch also
    // uses, so wait on the active tally instead: that only exists once the
    // strategy list has resolved off the stream.
    await waitFor(() => expect(visibleText()).toContain("0 active"));
    expect(visibleText()).toBe("Strategies0 activefunds unknown");

    emitCareer(fixture, {
      economy: { funds: 1234, reputation: 0, science: 0 },
      strategies: { active: [], all: [EXPENSIVE], activeCount: 0 },
    });

    // The other side of the gate: the compact balance appears.
    await waitFor(() => expect(visibleText()).toBe("Strategies0 active1kf"));
  });
});
