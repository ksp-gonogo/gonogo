import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import kerbinFlight from "./__fixtures__/kerbin-flight-two-experiments.json";
import { ScienceBenchComponent } from "./index";

/**
 * ScienceBench's behavior-preservation golden
 * dual-run (mirrors `TargetPicker/dual-run.test.tsx`): the SAME two-
 * experiment state, rendered once off the legacy `DataSource` (`sci.
 * experiments`'s `part`-keyed shape) and once off the stream (`science.
 * experiments`'s `partName`-keyed shape), must produce byte-identical DOM
 * at `delay=0` — `parseExperiments` (index.tsx) reads either field name
 * identically, and neither field is ever rendered, so the two wire shapes
 * are provably interchangeable for this fixture.
 */
afterEach(() => {
  cleanup();
});

describe("ScienceBench — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same experiment list", async () => {
    const mode = { name: "default-8x10", w: 8, h: 10 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: ScienceBenchComponent,
      fixture: kerbinFlight,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["science.experiments"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: Object.keys(kerbinFlight)
        .filter((k) => k !== "_meta" && k !== "sci.experiments")
        .map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "sb-dual" }}>
          <ScienceBenchComponent id="sb-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const [key, value] of Object.entries(kerbinFlight)) {
        if (key === "_meta" || key === "sci.experiments") continue;
        legacyAux.source.emit(key, value);
      }
      streamFixture.emit(
        "science.experiments",
        kerbinFlight["sci.experiments"].map((e) => ({
          partName: e.part,
          location: "experiment",
          experimentId: e.subjectId.split("@")[0],
          subjectId: e.subjectId,
          title: e.title,
          dataAmount: e.dataAmount,
        })),
      );
    });

    await waitFor(() => {
      if (!container.textContent?.includes("Temperature Scan")) {
        throw new Error("stream leg has not rendered the experiment list yet");
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
