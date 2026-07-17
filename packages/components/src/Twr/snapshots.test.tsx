/**
 * DOM-snapshot regression tests for the Twr widget.
 *
 * Catches structural drift (rendered text, element order, attribute
 * changes) across every fixture × mode combination registered for the
 * widget.
 *
 * `index.tsx`'s headline read (`useStream<VesselState>("vessel.state")?.twr`)
 * is a pure canonical stream read with NO legacy fallback at all —
 * `useStream` never consults a legacy `DataSource`, so the shared
 * `snapshotWidgetMode` helper (which mounts no `TelemetryProvider` for a plain
 * legacy fixture) can never feed it. This file builds its own per-fixture
 * stream render instead, translating each fixture's flat `dv.currentTWR` value
 * into the `vessel.orbit`/`vessel.propulsion` inputs `vessel.state.twr`
 * actually derives from — same construction `index.test.tsx` uses:
 * `thrust = twr * STANDARD_GRAVITY`, `totalMass = 1` tonne, so `deriveTwr`'s
 * `currentThrust / (totalMass · g)` reproduces the fixture's exact TWR value.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/components exec vitest run src/Twr/snapshots -u`.
 *
 * One committed-baseline nuance from this migration: `standard-launch-ok`'s
 * gauge-needle SVG coordinates differ from the pre-migration baseline at the
 * ~14th significant digit (e.g. `11.497177969980871` -> `...980866`) — the
 * multiply-then-divide-by-`STANDARD_GRAVITY` round trip through `deriveTwr`
 * introduces float noise a directly-injected `1.82` literal never hit. The
 * displayed value ("1.82"), every arc/zone path, and the visual result are all
 * identical; only that snapshot was regenerated.
 */
import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import atmosphereAscent from "./__fixtures__/atmosphere-ascent-ok.json";
import engineOff from "./__fixtures__/engine-off-empty.json";
import heavy from "./__fixtures__/heavy-lifter-warn.json";
import pinned from "./__fixtures__/pinned-high.json";
import standard from "./__fixtures__/standard-launch-ok.json";
import vacuumLow from "./__fixtures__/vacuum-low-nogo.json";
import { TwrComponent } from "./index";

interface TwrFixture {
  "dv.currentTWR": number | null;
}

const FIXTURES: Record<string, TwrFixture> = {
  "standard-launch-ok": standard,
  "atmosphere-ascent-ok": atmosphereAscent,
  "heavy-lifter-warn": heavy,
  "vacuum-low-nogo": vacuumLow,
  "pinned-high": pinned,
  "engine-off-empty": engineOff,
};

const config = getWidget("twr");
if (!config) throw new Error("twr missing from widgets.ts");

const STANDARD_GRAVITY = 9.80665;

const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

// `deriveVesselState` produces NO record until `vessel.orbit` is whole (it
// early-returns `undefined` otherwise), and every derived field — TWR
// included — hangs off that record. A minimal OnRails orbit is emitted
// alongside `vessel.propulsion` so the record exists and `deriveTwr` can run.
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

async function snapshotTwrStream(
  fixture: TwrFixture,
  mode: {
    name: string;
    w: number;
    h: number;
    config?: Record<string, unknown>;
  },
): Promise<string> {
  const streamFixture = setupStreamFixture({
    carriedChannels: VESSEL_STATE_INPUTS,
    pinnedUt: 10,
  });

  const { container } = render(
    <streamFixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
        <TwrComponent
          config={mode.config ?? {}}
          id="snap"
          w={mode.w}
          h={mode.h}
        />
      </DashboardItemContext.Provider>
    </streamFixture.Provider>,
  );

  const twr = fixture["dv.currentTWR"];
  if (typeof twr === "number") {
    const thrust = twr * STANDARD_GRAVITY;
    act(() => {
      streamFixture.emit("vessel.orbit", ORBIT);
      streamFixture.emit("vessel.propulsion", {
        totalMass: 1,
        dryMass: 0,
        currentThrust: thrust,
        availableThrust: thrust,
      });
    });
    await waitFor(() => {
      const point = streamFixture.store.sample(
        "vessel.state.twr",
        streamFixture.store.currentFrame(),
      );
      if (point?.payload === undefined || point.payload === null) {
        throw new Error("vessel.state.twr has not resolved off the stream yet");
      }
    });
  }
  // engine-off-empty (twr null): nothing emitted at all — the empty state is
  // the correct, already-settled render.

  return stripVolatile(container.innerHTML);
}

describe("Twr DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotTwrStream(fixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
