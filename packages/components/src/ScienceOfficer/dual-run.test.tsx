import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import mobileLabIdle from "./__fixtures__/mobile-lab-idle-one-instrument.json";
import { ScienceOfficerComponent } from "./index";

/**
 * ScienceOfficer's M3 science.lab batch behavior-preservation golden
 * dual-run (mirrors `PowerSystems/dual-run.test.tsx`): the SAME idle-lab +
 * single-instrument state, rendered once off a plain legacy `DataSource`
 * (`science.lab` fed as a literal fixture key — `useDataValue`'s legacy
 * path reads it straight off the source with no wire-shape translation)
 * and once with `science.lab` genuinely carried over the stream (mapped
 * 1:1 by `map-topic.ts`'s identity entry), must produce byte-identical DOM
 * at `delay=0`. Unlike ScienceBench's `sci.experiments` -> `science.
 * experiments` RENAME, `science.lab` has no legacy key at all — this dual
 * -run instead proves the read-layer swap itself (legacy `DataSource` read
 * vs `TelemetryProvider`-routed stream read of the identical topic name) is
 * a no-op, independent of whether a prior legacy key ever existed.
 */
afterEach(() => {
  cleanup();
});

describe("ScienceOfficer — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off a plain legacy DataSource for the same idle-lab payload", async () => {
    const mode = { name: "default-6x7", w: 6, h: 7 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: ScienceOfficerComponent,
      fixture: mobileLabIdle,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["science.lab"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: Object.keys(mobileLabIdle)
        .filter((k) => k !== "_meta" && k !== "science.lab")
        .map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "so-dual" }}>
          <ScienceOfficerComponent id="so-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const [key, value] of Object.entries(mobileLabIdle)) {
        if (key === "_meta" || key === "science.lab") continue;
        legacyAux.source.emit(key, value);
      }
      streamFixture.emit("science.lab", mobileLabIdle["science.lab"]);
    });

    await waitFor(() => {
      if (!container.textContent?.includes("Mobile Processing Lab MPL-LG-2")) {
        throw new Error("stream leg has not rendered the lab status yet");
      }
      if (container.textContent?.includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
