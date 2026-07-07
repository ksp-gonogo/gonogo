import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import strongDirectKsc from "./__fixtures__/strong-direct-ksc.json";
import { CommSignalComponent } from "./index";

/**
 * CommSignal's M3 batch-2 behavior-preservation golden dual-run (mirrors
 * `ThermalStatus/dual-run.test.tsx`, batch 1): the SAME signal state,
 * rendered once off the legacy `DataSource` and once off the stream, must
 * produce byte-identical DOM at `delay=0`.
 *
 * `strong-direct-ksc` is chosen because every one of its 5 fields is
 * present: `comm.connected`/`comm.signalStrength` stream (MAPPED ->
 * `vessel.comms.*`), `comm.controlState`/`comm.controlStateName`/`comm.
 * signalDelay` read off a legacy AUX source (GAPPED — shape-mismatch/no
 * home, see `map-topic.ts`) registered alongside the `TelemetryProvider`.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = [
  "comm.controlState",
  "comm.controlStateName",
  "comm.signalDelay",
] as const;

describe("CommSignal — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same signal state", async () => {
    const mode = { name: "default-6x5", w: 6, h: 5 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: CommSignalComponent,
      fixture: strongDirectKsc,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.comms"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: GAPPED_KEYS.map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-dual" }}>
          <CommSignalComponent id="comm-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(
          key,
          strongDirectKsc[key as keyof typeof strongDirectKsc],
        );
      }
      streamFixture.emit("vessel.comms", {
        connected: strongDirectKsc["comm.connected"],
        signalStrength: strongDirectKsc["comm.signalStrength"],
      });
    });

    // "Full" alone isn't sufficient — that text comes from the legacy AUX
    // source's comm.controlStateName, which can land before the STREAM
    // leg's mapped vessel.comms emission has actually propagated through
    // the store. Wait on a value the stream leg alone produces (the
    // signal-strength headline) so the race can't produce a false green.
    await waitFor(() => {
      if (!container.textContent?.includes("87%")) {
        throw new Error("stream leg has not rendered signal strength yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
