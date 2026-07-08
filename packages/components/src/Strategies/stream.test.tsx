import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { StrategiesComponent } from "./index";

/**
 * The M3/M3b career batch's stream test-adapter proof for Strategies:
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport`. `career.funds`/
 * `career.reputation`/`career.science` (-> `career.status.economy.*`) AND
 * `strategies.all` (-> `career.status.strategies.all`, M3b career-detail
 * batch) all stream now — no legacy AUX needed for this widget any more.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("Strategies — genuinely runs off the stream (M3/M3b career batch)", () => {
  it("renders the funds/reputation/science tallies derived from career.status.economy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "strats-stream" }}>
          <StrategiesComponent id="strats-stream" w={9} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

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

    await waitFor(() => expect(screen.getByText("289,848f")).toBeTruthy());
    expect(screen.getByText("420 rep")).toBeTruthy();
    expect(screen.getByText("145 sci")).toBeTruthy();
  });

  it("renders a strategy card derived from career.status.strategies.all", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "strats-stream-2" }}
        >
          <StrategiesComponent id="strats-stream-2" w={9} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

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
        // parseStrategies (and the widget) reads `strategies.all` only —
        // `active` is derived client-side by filtering `isActive` — so the
        // entry must be present in `all`, not just `active`.
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
