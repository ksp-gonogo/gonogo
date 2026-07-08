import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ContractManagerComponent } from "./index";

/**
 * The M3b career-detail batch's stream test-adapter proof for
 * ContractManager: genuinely running off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`.
 * `contracts.active`/`contracts.offered` (-> `career.status.contracts.
 * active`/`.offered`) are the two mapped reads. `contracts.
 * completedRecent`/`t.universalTime`/`v.altitude` are all still-gapped or
 * unrelated-to-career keys — carried by a `setupMockDataSource` AUX, same
 * mixed-source pattern the vessel-gap batch established.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("ContractManager — genuinely runs off the stream (M3b career-detail batch)", () => {
  it("renders active + offered contracts derived from career.status.contracts", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "contracts.completedRecent" },
        { key: "t.universalTime" },
        { key: "v.altitude" },
      ],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "cm-stream" }}>
          <ContractManagerComponent id="cm-stream" w={6} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("career.status")).toBe(true);

    act(() => {
      legacyAux.source.emit("contracts.completedRecent", []);
      legacyAux.source.emit("t.universalTime", 1500500);
      legacyAux.source.emit("v.altitude", 85000);
      fixture.emit("career.status", {
        economy: null,
        facilities: null,
        contracts: {
          active: [
            {
              id: "8834021456123789",
              title: "Rescue Kerbal from orbit of Kerbin",
              agent: "Kerbin Space Agency Rescue Division",
              state: "Active",
              fundsAdvance: 5000,
              fundsCompletion: 25000,
              scienceCompletion: 15,
              reputationCompletion: 8,
              dateDeadline: 2500000,
              parameters: [
                { title: "Rescue Buzz Kerman", state: "Incomplete" },
                { title: "Return to Kerbin", state: "Incomplete" },
              ],
            },
          ],
          offered: [
            {
              id: "1122334455667788",
              title: "Test RT-10 solid fuel booster in flight",
              agent: "Kerbin Space Program",
              state: "Offered",
              fundsAdvance: 0,
              fundsCompletion: 8500,
              scienceCompletion: 5,
              reputationCompletion: 3,
              dateDeadline: 0,
              parameters: [],
            },
          ],
        },
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() =>
      expect(
        screen.getByText("Rescue Kerbal from orbit of Kerbin"),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Rescue Buzz Kerman")).toBeTruthy();
    expect(
      screen.getByText("Test RT-10 solid fuel booster in flight"),
    ).toBeTruthy();

    teardownMockDataSource(legacyAux);
  });
});
