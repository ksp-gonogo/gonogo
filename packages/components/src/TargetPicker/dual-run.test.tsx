import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import noTarget from "./__fixtures__/no-target.json";
import { TargetPickerComponent } from "./index";

/**
 * TargetPicker's R6 de-Telemachus roster render.
 *
 * The old M3 dual-run compared a legacy `tar.availableVessels` array render
 * against the `system.vessels` roster render for byte-identical DOM. R6 drops
 * the legacy `"data"` MockDataSource leg entirely — the array shape is a
 * Telemachus-only wart with no home once the fork goes (the roster is read
 * canonically off the stream now, `index.tsx`'s `useTelemetry("system.vessels")`),
 * so there is nothing to compare against. What remains is the surviving leg:
 * the roster renders correctly straight off the stream.
 *
 * Bodies still come off `useCelestialBodies` (a `getDataSource()` shim-bypass —
 * always legacy), so `no-target.json`'s full body set is fed through a small
 * `"data"` AUX purely so `bodyIndex: 1` resolves to "Kerbin".
 */
afterEach(() => {
  cleanup();
});

describe("TargetPicker — R6 roster render off the stream (delay=0)", () => {
  it("renders the system.vessels roster with body/type resolved, no legacy array shape", async () => {
    const streamFixture = setupStreamFixture({
      carriedChannels: ["system.vessels"],
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
