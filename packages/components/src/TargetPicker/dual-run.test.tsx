import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import noTarget from "./__fixtures__/no-target.json";
import { TargetPickerComponent } from "./index";

/**
 * TargetPicker's de-Telemachus roster render.
 *
 * The old dual-run compared a legacy `tar.availableVessels` array render
 * against the `system.vessels` roster render for byte-identical DOM. This version drops
 * the legacy `"data"` MockDataSource leg entirely — the array shape is a
 * Telemachus-only wart with no home once the fork goes (the roster is read
 * canonically off the stream now, `index.tsx`'s `useTelemetry("system.vessels")`),
 * so there is nothing to compare against. What remains is the surviving leg:
 * the roster renders correctly straight off the stream.
 *
 * Bodies come off `useCelestialBodies` → the `system.bodies` stream Topic, so a
 * one-body `system.bodies` emit (Kerbin at index 1) resolves the roster entry's
 * `bodyIndex: 1` to "Kerbin". The `"data"` AUX only carries the target-detail
 * scalar reads (`tar.name` etc.) the widget still reads via the legacy shim.
 */
describe("TargetPicker — R6 roster render off the stream (delay=0)", () => {
  it("renders the system.vessels roster with body/type resolved, no legacy array shape", async () => {
    const streamFixture = setupStreamFixture({
      carriedChannels: ["system.vessels", "system.bodies"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: Object.keys(noTarget)
        .filter((k) => k !== "_meta" && k !== "tar.availableVessels")
        .map((key) => ({ key })),
      connectSource: true,
    });

    render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "tp-dual" }}>
          <TargetPickerComponent id="tp-dual" w={6} h={11} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const [key, value] of Object.entries(noTarget)) {
        if (key === "_meta" || key === "tar.availableVessels") continue;
        legacyAux.source.emit(key, value);
      }
      streamFixture.emit("system.bodies", {
        bodies: [
          { index: 0, name: "Kerbol", parentIndex: null, orbit: null },
          { index: 1, name: "Kerbin", parentIndex: 0, orbit: null },
        ],
      });
      streamFixture.emit("system.vessels", {
        vessels: [
          {
            vesselId: "aaaa-1111",
            name: "Kerbin Station I",
            vesselType: 1, // Station
            situation: 3, // Orbiting
            bodyIndex: 1, // Kerbin
          },
        ],
      });
    });

    const vesselsTab = await screen.findByRole("tab", { name: "Vessels" });
    act(() => {
      vesselsTab.click();
    });

    await waitFor(() =>
      expect(screen.getByText("Kerbin Station I")).toBeTruthy(),
    );
    expect(screen.getByText("Station · Kerbin")).toBeTruthy();
    // No position on the roster shape -> distance renders "—".
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);

    teardownMockDataSource(legacyAux);
  });
});
