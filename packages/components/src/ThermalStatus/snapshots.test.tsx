/**
 * DOM-snapshot regression tests for the ThermalStatus widget.
 *
 * Catches structural drift (rendered text, element order, attribute
 * changes) across every fixture × mode combination registered for the
 * widget.
 *
 * `index.tsx`'s reads (`useTelemetry("vessel.thermal")?.<field>`) are ONE-ARG
 * canonical `TopicId` reads with no legacy fallback at all, so the shared
 * `snapshotWidgetMode` helper (which mounts no `TelemetryProvider` for a plain
 * legacy fixture) can never feed them. This file builds its own per-fixture
 * stream render instead, translating each fixture's flat `therm.*` keys into a
 * single `vessel.thermal` emit.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/components exec vitest run src/ThermalStatus/snapshots -u`.
 */
import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import cruise from "./__fixtures__/cruise-nominal.json";
import engineOverheat from "./__fixtures__/engine-overheat.json";
import noData from "./__fixtures__/no-thermal-data.json";
import reentryCritical from "./__fixtures__/reentry-critical.json";
import reentryWarning from "./__fixtures__/reentry-warning.json";
import solar from "./__fixtures__/solar-heating.json";
import { ThermalStatusComponent } from "./index";

interface ThermalFixture {
  "therm.hottestPartName": string;
  "therm.hottestPartTemp": number;
  "therm.hottestPartMaxTemp": number;
  "therm.hottestPartTempRatio": number;
  "therm.hottestEngineTemp": number;
  "therm.hottestEngineMaxTemp": number;
  "therm.hottestEngineTempRatio": number;
  "therm.anyEnginesOverheating": boolean;
  "therm.heatShieldTempCelsius": number;
  "therm.heatShieldFlux": number;
}

const FIXTURES: Record<string, ThermalFixture> = {
  "cruise-nominal": cruise,
  "reentry-warning": reentryWarning,
  "reentry-critical": reentryCritical,
  "engine-overheat": engineOverheat,
  "solar-heating": solar,
  "no-thermal-data": noData,
};

const config = getWidget("thermal-status");
if (!config) throw new Error("thermal-status missing from widgets.ts");

async function snapshotThermalStream(
  fixture: ThermalFixture,
  mode: {
    name: string;
    w: number;
    h: number;
    config?: Record<string, unknown>;
  },
): Promise<string> {
  const streamFixture = setupStreamFixture({
    carriedChannels: ["vessel.thermal"],
    pinnedUt: 10,
  });

  const { container } = render(
    <streamFixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
        <ThermalStatusComponent
          config={mode.config ?? {}}
          id="snap"
          w={mode.w}
          h={mode.h}
        />
      </DashboardItemContext.Provider>
    </streamFixture.Provider>,
  );

  act(() => {
    streamFixture.emit("vessel.thermal", {
      hottestPart: {
        name: fixture["therm.hottestPartName"],
        skinTemp: fixture["therm.hottestPartTemp"],
        skinMaxTemp: fixture["therm.hottestPartMaxTemp"],
      },
      maxInternalTempRatio: fixture["therm.hottestPartTempRatio"],
      hottestEngineTemp: fixture["therm.hottestEngineTemp"],
      hottestEngineMaxTemp: fixture["therm.hottestEngineMaxTemp"],
      hottestEngineTempRatio: fixture["therm.hottestEngineTempRatio"],
      anyEnginesOverheating: fixture["therm.anyEnginesOverheating"],
      heatShieldTempCelsius: fixture["therm.heatShieldTempCelsius"],
      heatShieldFlux: fixture["therm.heatShieldFlux"],
    });
  });

  // Sample the store directly rather than a DOM signal — the no-thermal-data
  // fixture's settled state IS the empty "No thermal data" placeholder, so
  // waiting on rendered content isn't a reliable "landed" signal across
  // every fixture.
  await waitFor(() => {
    const point = streamFixture.store.sample(
      "vessel.thermal",
      streamFixture.store.currentFrame(),
    );
    if (point === undefined) {
      throw new Error("vessel.thermal has not resolved off the stream yet");
    }
  });

  return stripVolatile(container.innerHTML);
}

describe("ThermalStatus DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotThermalStream(fixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
