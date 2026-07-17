import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor, within } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import maxWarp from "./__fixtures__/max-warp-100000x.json";
import paused from "./__fixtures__/paused-in-flight.json";
import physics from "./__fixtures__/physics-warp-4x-atmosphere.json";
import rails from "./__fixtures__/rails-warp-1000x.json";
import realtime from "./__fixtures__/realtime-1x.json";
import spaceCenter from "./__fixtures__/space-center-no-flight.json";
import { WarpControlComponent } from "./index";

const FIXTURES = {
  "realtime-1x": realtime,
  "physics-warp-4x-atmosphere": physics,
  "rails-warp-1000x": rails,
  "max-warp-100000x": maxWarp,
  "paused-in-flight": paused,
  "space-center-no-flight": spaceCenter,
};

const config = getWidget("warp-control");
if (!config) throw new Error("warp-control missing from widgets.ts");

interface WarpFixture {
  "t.currentRate": number;
  "t.timeWarp": number;
  "t.warpMode": string;
  "t.isPaused": boolean;
  "kc.scene": string;
  "kc.padOccupied": boolean;
  "career.mode": string;
}

interface Mode {
  name: string;
  w: number;
  h: number;
  config?: Record<string, unknown>;
}

/**
 * WarpControl is de-Telemachus'd: it reads its whole state off the
 * native `time.warp` Topic via canonical `useTelemetry`, with no legacy
 * read-fallback. So the DOM snapshot feeds the SAME warp state the fixtures
 * describe through the real stream pipeline (`TelemetryProvider` +
 * `TelemetryClient`/`TimelineStore`) instead of a legacy `MockDataSource`.
 *
 * Scene streams too — `useGameContext` reads `spaceCenter.scene` off the
 * canonical stream now (migrated off the `kc.scene` shim), so it rides
 * `carriedChannels` alongside `time.warp`. The legacy `data` source stays
 * connected purely so `useDataStreamStatus("data", "t.timeWarp")` reads
 * "live" (=> no disconnected badge) and `useExecuteAction("data")` has a
 * target — reproducing the "connected, streaming" status these fixtures
 * depict (and the committed snapshots reflect); it no longer feeds any value.
 */
async function snapshotWarpStream(
  fixture: WarpFixture,
  mode: Mode,
): Promise<string> {
  const streamFixture = setupStreamFixture({
    carriedChannels: ["spaceCenter.scene"],
    pinnedUt: 10,
  });
  // Connected only for the status badge + action target — no value reads.
  const legacyAux = await setupMockDataSource({
    id: "data",
    keys: [
      { key: "kc.scene" },
      { key: "kc.padOccupied" },
      { key: "career.mode" },
    ],
    connectSource: true,
  });

  const { container } = render(
    <streamFixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
        <WarpControlComponent
          config={mode.config ?? {}}
          id="snap"
          w={mode.w}
          h={mode.h}
        />
      </DashboardItemContext.Provider>
    </streamFixture.Provider>,
  );

  act(() => {
    // Scene rides the canonical stream (useGameContext reads spaceCenter.scene).
    streamFixture.emit("spaceCenter.scene", { scene: fixture["kc.scene"] });
    streamFixture.emit("time.warp", {
      warpRate: fixture["t.currentRate"],
      warpRateIndex: fixture["t.timeWarp"],
      // Contract WarpMode enum: 0 = High, 1 = Low ("Physics"). See
      // normalizeWarpMode's doc comment in index.tsx.
      warpMode: fixture["t.warpMode"] === "Physics" ? 1 : 0,
      paused: fixture["t.isPaused"],
    });
  });

  // Wait until the warp state has settled off the stream — the rate readout
  // starts as the "—" loading placeholder before the first sample resolves.
  await waitFor(() => {
    const label = within(container).getByRole("img").getAttribute("aria-label");
    if (!label || label.endsWith("—")) {
      throw new Error("warp state has not rendered off the stream yet");
    }
  });

  const html = stripVolatile(container.innerHTML);
  // `teardownMockDataSource` unmounts (cleanup) before it disconnects the aux
  // source, so no separate cleanup() is needed here — html is already captured.
  teardownMockDataSource(legacyAux);
  return html;
}

describe("WarpControl DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWarpStream(fixture as WarpFixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
