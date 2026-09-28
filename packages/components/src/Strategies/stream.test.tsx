import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { StrategiesComponent } from "./index";

// Unmounted before `clearActionHandlers()`, which would otherwise update a mounted widget outside act().
const renderedTrees: Array<() => void> = [];

/** Strategies off the real stream pipeline via `StubTransport`. */
afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

describe("Strategies: genuinely runs off the stream (M3/M3b career batch)", () => {
  it("renders the funds/reputation/science tallies derived from career.status.economy", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "strats-stream" }}>
          <StrategiesComponent id="strats-stream" w={9} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);

    expect(fixture.transport.isSubscribed("career.status")).toBe(true);

    act(() => {
      fixture.emit("career.status", {
        economy: { funds: 289848, reputation: 420, science: 145 },
        facilities: null,
        contracts: null,
        strategies: { active: [], all: [], activeCount: 0 },
        tech: null,
      });
    });

    /*
     * `textContent` is what a screen reader announces: the glyphs are
     * aria-hidden, so the hidden word is what names each tally. Reputation and
     * science carry one decimal in the unit model.
     */
    const funds = await screen.findByText("289,848");
    expect(funds.textContent).toBe("289,848f funds");
    expect(screen.getByText("420.0").textContent).toBe("420.0 reputation");
    expect(screen.getByText("145.0").textContent).toBe("145.0 science");
  });

  it("renders a strategy card derived from career.status.strategies.all", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "strats-stream-2" }}
        >
          <StrategiesComponent id="strats-stream-2" w={9} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);

    act(() => {
      const aggressiveNegotiations = {
        id: "AggressiveNegotiations",
        title: "Aggressive Negotiations",
        description: "Push harder on every deal.",
        department: "Operations",
        isActive: true,
        factor: 0.15,
        dateActivated: 33246,
        requiredReputation: -10,
        initialCostFunds: 0,
        initialCostScience: 0,
        initialCostReputation: 14.5,
        hasFactorSlider: true,
        factorSliderDefault: 0.05,
        factorSliderSteps: 20,
        canActivate: false,
        activateBlockedReason: "Strategy already active.",
        canDeactivate: true,
        deactivateBlockedReason: "",
        effect: "Effects: -1.5% funds off launch costs.",
      };
      fixture.emit("career.status", {
        economy: { funds: 289848, reputation: 420, science: 145 },
        facilities: null,
        contracts: null,
        // The widget reads `strategies.all` only; `active` is derived from `isActive`.
        strategies: {
          active: [aggressiveNegotiations],
          all: [aggressiveNegotiations],
          activeCount: 1,
        },
        tech: null,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Aggressive Negotiations")).toBeTruthy(),
    );
    expect(screen.getByText("Operations")).toBeTruthy();
  });
});
