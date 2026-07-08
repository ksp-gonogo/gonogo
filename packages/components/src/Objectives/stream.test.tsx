import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ObjectivesComponent } from "./index";

/**
 * The M3b career-detail batch's stream test-adapter proof for Objectives:
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport`. `contracts.active` (->
 * `career.status.contracts.active`) is the one mapped read this widget
 * shares with ContractManager (`parseContracts`/`contractObjectives`).
 * `mh.*` (no mission running) is carried by a `setupMockDataSource` AUX,
 * same mixed-source pattern the vessel-gap batch established.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("Objectives — genuinely runs off the stream (M3b career-detail batch)", () => {
  it("renders contract-parameter objectives derived from career.status.contracts.active", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "mh.available" }],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "obj-stream" }}>
          <ObjectivesComponent id="obj-stream" w={5} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("career.status")).toBe(true);

    act(() => {
      legacyAux.source.emit("mh.available", false);
      fixture.emit("career.status", {
        economy: null,
        facilities: null,
        contracts: {
          active: [
            {
              id: "9001",
              title: "Test the LV-909 in flight",
              agent: "C7 Aerospace",
              state: "Active",
              fundsAdvance: 3000,
              fundsCompletion: 9000,
              scienceCompletion: 0,
              reputationCompletion: 2,
              dateDeadline: 0,
              parameters: [
                {
                  title: "Test LV-909: Flying over Kerbin",
                  state: "Incomplete",
                },
              ],
            },
          ],
          offered: [],
        },
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Test LV-909: Flying over Kerbin")).toBeTruthy(),
    );
    expect(screen.getByText("Test the LV-909 in flight")).toBeTruthy();

    teardownMockDataSource(legacyAux);
  });
});
