import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { StrategiesComponent } from "./index";

/**
 * The M3 career batch's stream test-adapter proof for Strategies: genuinely
 * running off the real `TelemetryProvider`/`TelemetryClient`/`TimelineStore`
 * pipeline via `StubTransport`. `career.funds`/`career.reputation`/
 * `career.science` are the three mapped reads (-> `career.status.economy.*`,
 * map-topic.ts). `strategies.all` stays gapped (no stable id/costs on the
 * wire yet — see map-topic.ts's doc comment) — carried by a
 * `setupMockDataSource` AUX, same mixed-source pattern the vessel-gap batch
 * established.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("Strategies — genuinely runs off the stream (M3 career batch)", () => {
  it("renders the funds/reputation/science tallies derived from career.status.economy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "strategies.all" }],
      connectSource: true,
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
      legacyAux.source.emit("strategies.all", []);
      fixture.emit("career.status", {
        economy: { funds: 289848, reputation: 420, science: 145 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() => expect(screen.getByText("289,848f")).toBeTruthy());
    expect(screen.getByText("420 rep")).toBeTruthy();
    expect(screen.getByText("145 sci")).toBeTruthy();

    teardownMockDataSource(legacyAux);
  });
});
