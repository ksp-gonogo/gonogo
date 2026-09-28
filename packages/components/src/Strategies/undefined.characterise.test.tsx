import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { ReadingProbe } from "../test/ReadingProbe";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { StrategiesComponent } from "./index";

/**
 * What Strategies does when its telemetry reads are absent. A missing strategy
 * list swaps the widget for a placeholder; a missing balance fails closed, so
 * Activate stays disabled.
 */

// Unmounted before `clearActionHandlers()`, which would otherwise update a mounted widget outside act().
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
  { probe = false }: { probe?: boolean } = {},
) {
  const result = render(
    <fixture.Provider>
      {probe && <ReadingProbe topic="career.status" />}
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

    // The placeholder is titled "Strategies" and the loaded widget "Admin Building", so the title observes the gate.
    expect(screen.getByText("Strategies")).toBeInTheDocument();
    expect(screen.getByText(/Awaiting career data\.\.\./)).toBeInTheDocument();
    expect(screen.queryByText("Admin Building")).toBeNull();
    expect(screen.queryByLabelText("Active")).toBeNull();
    expect(screen.queryByLabelText("Available")).toBeNull();
    expect(screen.queryByRole("button", { name: "Activate" })).toBeNull();
    expect(screen.queryAllByText(NULL_DISPLAY)).toHaveLength(0);
    expect(visibleText()).toBe("StrategiesAwaiting career data...");
  });

  it("says nothing at all in a short box, because the placeholder is itself gated on height", () => {
    // At h=3 the awaiting branch renders an empty body.
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

    // An empty array is not absence: the widget states "none available".
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
    renderStrategies(fixture, undefined, { probe: true });

    // Economy without strategies is indistinguishable from the topic never having arrived.
    emitCareer(fixture, {
      economy: { funds: 289_848, reputation: 420, science: 145 },
      strategies: null,
    });

    await screen.findByText("career.status: observed");
    expect(screen.getByText(/Awaiting career data/)).toBeInTheDocument();
    // The funds the payload did carry are not shown.
    expect(visibleText()).not.toContain("289,848");
  });

  it("fires when `strategies.all` itself is null", async () => {
    const fixture = newFixture();
    renderStrategies(fixture, undefined, { probe: true });

    emitCareer(fixture, {
      strategies: { active: [], all: null, activeCount: 0 },
    });

    await screen.findByText("career.status: observed");
    expect(screen.getByText(/Awaiting career data/)).toBeInTheDocument();
  });
});

describe("Strategies: null versus undefined", () => {
  it("does NOT distinguish a whole-topic tombstone from a topic that never arrived", async () => {
    const fixture = newFixture();
    renderStrategies(fixture, undefined, { probe: true });

    act(() => {
      // A tombstone folds into the same placeholder as never-arrived.
      fixture.emit("career.status", null);
    });

    await screen.findByText("career.status: absent");
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
    // Three labelled dashes: each null token keeps its currency's symbol.
    const dashes = screen.getAllByText(NULL_DISPLAY);
    expect(dashes).toHaveLength(3);
    expect(dashes[0]?.parentElement?.textContent).toBe(
      `${NULL_DISPLAY}f funds·${NULL_DISPLAY} reputation·${NULL_DISPLAY} science`,
    );
  });

  // An absent balance is not unlimited money on a control that commits career funds.
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

    // The control for the test above: the refusal is the same whether the balance is short or absent.
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
  // The tiny bucket keeps its funds row while the economy is absent.
  it("says the funds balance is unknown while economy is absent, and shows it once funds arrive", async () => {
    const fixture = newFixture();
    // w=4 is the tiny bucket.
    renderStrategies(fixture, { w: 4, h: 4 });

    emitCareer(fixture, {
      economy: null,
      strategies: { active: [], all: [EXPENSIVE], activeCount: 0 },
    });

    // The tiny panel shares the awaiting branch's title, so wait on the active tally instead.
    await waitFor(() => expect(visibleText()).toContain("0 active"));
    expect(visibleText()).toBe("Strategiesfunds unknown· 0 active");

    emitCareer(fixture, {
      economy: { funds: 1234, reputation: 0, science: 0 },
      strategies: { active: [], all: [EXPENSIVE], activeCount: 0 },
    });

    await waitFor(() => expect(visibleText()).toBe("Strategies1kf· 0 active"));
  });
});
