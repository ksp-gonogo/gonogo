import { DashboardItemContext } from "@gonogo/core";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { renderWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import noTarget from "./__fixtures__/no-target.json";
import { TargetPickerComponent } from "./index";

/**
 * TargetPicker's M3 vessel-gap batch behavior-preservation golden dual-run
 * (mirrors `CurrentOrbit/dual-run.test.tsx`): the SAME roster state,
 * rendered once off the legacy `tar.availableVessels` array and once off
 * `system.vessels`, must produce byte-identical DOM at `delay=0` — both legs
 * with the Vessels tab clicked open (`renderWidgetMode`, not
 * `snapshotWidgetMode` — this scenario needs a post-mount interaction
 * before capture, which only the live-container helper supports).
 *
 * `system.vessels` carries no position/distance field at all
 * (`SystemViewProvider.BuildSystemVessels`'s own doc comment) — so the one
 * roster entry used here deliberately OMITS `position` on the legacy leg
 * too (`AvailableVesselEntry.position` is optional; `vectorMagnitude
 * (undefined)` already legitimately returns `Infinity` -> `formatDistance`'s
 * own "—" branch) rather than picking an unreachable case: this is the
 * genuine, provable-identical overlap between the two shapes, not a
 * contrived best-case.
 *
 * `no-target.json`'s full 17-body set is reused verbatim on both legs
 * (`useCelestialBodies` is a `getDataSource()` shim-bypass — always legacy,
 * see stream.test.tsx's own doc comment) so `bodyIndex: 1` resolves to
 * "Kerbin" identically either way.
 */
afterEach(() => {
  cleanup();
});

const ROSTER_ENTRY_LEGACY = {
  index: 0,
  name: "Kerbin Station I",
  type: "Station",
  situation: "ORBITING",
  body: "Kerbin",
};

describe("TargetPicker — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same vessel roster", async () => {
    const mode = { name: "default-6x11", w: 6, h: 11 };
    const legacyFixture = {
      ...noTarget,
      "tar.availableVessels": [ROSTER_ENTRY_LEGACY],
    };

    const legacy = await renderWidgetMode({
      Widget: TargetPickerComponent,
      fixture: legacyFixture,
      mode,
      connectSource: true,
    });
    const legacyVesselsTab = await within(legacy.container).findByRole("tab", {
      name: "Vessels",
    });
    act(() => {
      legacyVesselsTab.click();
    });
    await within(legacy.container).findByText("Kerbin Station I");
    const legacyHtml = stripVolatile(legacy.container.innerHTML);
    legacy.teardown();

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

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "tp-dual" }}>
          <TargetPickerComponent id="tp-dual" w={mode.w} h={mode.h} />
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

    await waitFor(() => {
      if (!container.textContent?.includes("Kerbin Station I")) {
        throw new Error("stream leg has not rendered the roster yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
