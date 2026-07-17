/**
 * DOM-snapshot regression tests for the CommSignal widget.
 *
 * CommSignal's reads are all stream reads now (`comms.link`, `vessel.comms`,
 * the derived `vessel.state.commsControlState*`, `comms.delay`), so the shared
 * `snapshotWidgetMode` helper (which mounts no `TelemetryProvider` for a plain
 * legacy fixture) can never feed them. This file builds its own per-fixture
 * stream render instead, translating each fixture's flat `comm.*` keys into the
 * raw wire emits the widget derives from. The fixture control-state NAMES
 * (None / Partial / Full) map onto the `ControlState` enum ordinals the wire
 * carries (0 / 3 / 4), which deriveVesselState collapses right back to the same
 * name + 0/1/2 level the widget renders.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/components exec vitest run src/CommSignal/snapshots -u`.
 */
import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import deepSpace from "./__fixtures__/deep-space-delay.json";
import noSignalData from "./__fixtures__/no-signal-data.json";
import noSignalOccluded from "./__fixtures__/no-signal-occluded.json";
import relay from "./__fixtures__/relay-probe-network.json";
import strong from "./__fixtures__/strong-direct-ksc.json";
import weak from "./__fixtures__/weak-fading-occlusion.json";
import { CommSignalComponent } from "./index";

interface CommFixture {
  "comm.connected"?: boolean;
  "comm.signalStrength"?: number;
  "comm.controlState"?: number;
  "comm.controlStateName"?: string;
  "comm.signalDelay"?: number;
}

const FIXTURES: Record<string, CommFixture> = {
  "strong-direct-ksc": strong,
  "weak-fading-occlusion": weak,
  "no-signal-occluded": noSignalOccluded,
  "relay-probe-network": relay,
  "deep-space-delay": deepSpace,
  "no-signal-data": noSignalData,
};

// Minimal orbit so `deriveVesselState` produces a record (it early-returns
// `undefined` until `vessel.orbit` is whole) — the derived commsControlState
// fields hang off that record.
const ORBIT = {
  sma: 682500,
  ecc: 0.00367,
  inc: 0.3,
  argPe: 12.5,
  mu: 3.5316e12,
  meanAnomalyAtEpoch: 0,
  epoch: 10,
  referenceBodyIndex: 1,
};

// Fixture control-state NAME -> `Sitrep.Contract.ControlState` enum ordinal
// (vessel-state.ts CONTROL_STATE_NAMES): None 0, Partial 3, Full 4.
const CONTROL_STATE_ORDINAL: Record<string, number> = {
  None: 0,
  Partial: 3,
  Full: 4,
};

const config = getWidget("comm-signal");
if (!config) throw new Error("comm-signal missing from widgets.ts");

async function snapshotCommStream(
  fixture: CommFixture,
  mode: {
    name: string;
    w: number;
    h: number;
    config?: Record<string, unknown>;
  },
): Promise<string> {
  const streamFixture = setupStreamFixture({
    carriedChannels: [
      "comms.link",
      "vessel.comms",
      "comms.delay",
      "vessel.state",
    ],
    pinnedUt: 10,
  });

  const { container } = render(
    <streamFixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
        <CommSignalComponent
          config={mode.config ?? {}}
          id="snap"
          w={mode.w}
          h={mode.h}
        />
      </DashboardItemContext.Provider>
    </streamFixture.Provider>,
  );

  const hasSignal = fixture["comm.connected"] !== undefined;
  if (hasSignal) {
    const name = fixture["comm.controlStateName"];
    act(() => {
      streamFixture.emit("comms.link", {
        connected: fixture["comm.connected"],
      });
      streamFixture.emit("vessel.comms", {
        connected: fixture["comm.connected"],
        signalStrength: fixture["comm.signalStrength"],
        controlState: name === undefined ? 0 : CONTROL_STATE_ORDINAL[name],
      });
      streamFixture.emit("comms.delay", {
        oneWaySeconds: fixture["comm.signalDelay"],
      });
      streamFixture.emit("vessel.orbit", ORBIT);
    });

    await waitFor(() => {
      const point = streamFixture.store.sample(
        "vessel.comms",
        streamFixture.store.currentFrame(),
      );
      if (point === undefined) {
        throw new Error("vessel.comms has not resolved off the stream yet");
      }
    });
  }

  return stripVolatile(container.innerHTML);
}

describe("CommSignal DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotCommStream(fixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
