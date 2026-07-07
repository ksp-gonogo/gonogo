import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import lkoKerbin from "./__fixtures__/lko-kerbin.json";
import { SemiMajorAxisComponent } from "./index";

/**
 * SemiMajorAxis's M3 batch-2 behavior-preservation golden dual-run (mirrors
 * `WarpControl/dual-run.test.tsx`, the pilot — this widget is all-mapped
 * for its one headline key, like WarpControl): the SAME sma state, rendered
 * once off the legacy `DataSource` and once off the stream, must produce
 * byte-identical DOM at `delay=0`.
 *
 * `lko-kerbin` also carries `_series` (a sparkline backfill) — the legacy
 * leg's `snapshotWidgetMode` only ever seeds top-level (non-`_`-prefixed)
 * keys, so the sparkline never actually renders real history in either leg
 * here; both legs read the same (empty) `useDataSeries` backfill off
 * whichever `DataSource` happens to be registered as `"data"`, since that
 * hook has no stream awareness at all (see `stream.test.tsx`'s doc
 * comment). `o.referenceBody` is GAPPED and reads off the legacy AUX
 * source in the stream leg.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = ["o.referenceBody"] as const;

describe("SemiMajorAxis — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same sma state", async () => {
    const mode = { name: "default-5x6", w: 5, h: 6 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: SemiMajorAxisComponent,
      fixture: lkoKerbin,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: GAPPED_KEYS.map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "sma-dual" }}>
          <SemiMajorAxisComponent id="sma-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(key, lkoKerbin[key as keyof typeof lkoKerbin]);
      }
      streamFixture.emit("vessel.orbit", { sma: lkoKerbin["o.sma"] });
    });

    // "Kerbin" alone isn't sufficient — that text comes from the legacy AUX
    // source's o.referenceBody, which can land before the STREAM leg's
    // mapped vessel.orbit emission has actually propagated through the
    // store. Wait on a value the stream leg alone produces (the sma
    // readout) so the race can't produce a false green.
    await waitFor(() => {
      if (!container.textContent?.includes("680.0 km")) {
        throw new Error("stream leg has not rendered sma yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
