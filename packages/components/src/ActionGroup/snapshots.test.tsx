import { DashboardItemContext } from "@ksp-gonogo/core";

import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  snapshotWidgetMode,
  stripVolatile,
  type WidgetSnapshotMode,
} from "../test/widgetDomSnapshot";
import ag1 from "./__fixtures__/ag1-parachutes-armed.json";
import coldPad from "./__fixtures__/cold-pad-all-off.json";
import gearDown from "./__fixtures__/gear-down-landed.json";
import launchConfig from "./__fixtures__/launch-config-sas-on.json";
import noSignal from "./__fixtures__/no-signal-paused.json";
import unknown from "./__fixtures__/unknown-state.json";
import { ActionGroupComponent } from "./index";

const FIXTURES: Record<string, Record<string, unknown>> = {
  "cold-pad-all-off": coldPad,
  "launch-config-sas-on": launchConfig,
  "gear-down-landed": gearDown,
  "ag1-parachutes-armed": ag1,
  "no-signal-paused": noSignal,
  "unknown-state": unknown,
};

const config = getWidget("action-group");
if (!config) throw new Error("action-group missing from widgets.ts");

// The group `.value` reads stay on the legacy `data` source (their mapped
// `vessel.control.*`/`vessel.state.*` topics are not carried below). `t.isPaused`
// and `comm.connected` are canonical stream reads now (`time.warp.paused` /
// `comms.link.connected`), so a fixture carrying either needs a hybrid render:
// legacy source for the value key + a stream provider for the two notices.
const STREAM_KEYS = new Set(["t.isPaused", "comm.connected"]);

async function snapshotActionGroupHybrid(
  fixture: Record<string, unknown>,
  mode: WidgetSnapshotMode,
): Promise<string> {
  const legacyKeys = Object.keys(fixture).filter(
    (k) => !k.startsWith("_") && !STREAM_KEYS.has(k),
  );
  const legacy = await setupMockDataSource({
    id: "data",
    keys: legacyKeys.map((key) => ({ key })),
    connectSource: false,
  });
  const stream = setupStreamFixture({
    carriedChannels: ["time.warp", "comms.link"],
    pinnedUt: 10,
  });

  try {
    const { container } = render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
          <ActionGroupComponent
            config={mode.config ?? {}}
            id="snap"
            w={mode.w}
            h={mode.h}
          />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );

    act(() => {
      for (const key of legacyKeys) legacy.source.emit(key, fixture[key]);
      if (fixture["t.isPaused"] !== undefined) {
        stream.emit("time.warp", { paused: fixture["t.isPaused"] });
      }
      if (fixture["comm.connected"] !== undefined) {
        stream.emit("comms.link", { connected: fixture["comm.connected"] });
      }
    });

    // The canonical `time.warp`/`comms.link` reads only land via the
    // provider's `beginFrame()` (a `requestAnimationFrame`, microtask under
    // jsdom), so flush two rAF ticks before reading the DOM — same pattern as
    // `widgetDomSnapshot`'s `flushProviderFrame`.
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });

    return stripVolatile(container.innerHTML);
  } finally {
    teardownMockDataSource(legacy);
  }
}

describe("ActionGroup DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    const needsStream = Object.keys(fixture).some((k) => STREAM_KEYS.has(k));
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = needsStream
          ? await snapshotActionGroupHybrid(fixture, mode)
          : await snapshotWidgetMode({
              Widget: ActionGroupComponent,
              fixture,
              mode,
            });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
