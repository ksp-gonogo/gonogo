import { DashboardItemContext } from "@ksp-gonogo/core";
import {
  dvCurrentStageResourceChannel,
  dvCurrentStageResourceMaxChannel,
} from "@ksp-gonogo/sitrep-client";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import { act, render, waitFor } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import ascentDrained from "./__fixtures__/ascent-stage-drained.json";
import asparagus from "./__fixtures__/asparagus-multi-stage.json";
import emptyOx from "./__fixtures__/empty-ox-mid-burn.json";
import lander from "./__fixtures__/lander-monoprop-only.json";
import launchpad from "./__fixtures__/launchpad-full-tanks.json";
import noEngine from "./__fixtures__/no-engine-data.json";
import { FuelStatusComponent } from "./index";

/**
 * DOM-snapshot regression tests for FuelStatus.
 *
 * `index.tsx` reads every value canonically off the stream
 * (`useTelemetry`/`useStream`) with no legacy fallback, so the shared
 * `snapshotWidgetMode` helper (which feeds a legacy `MockDataSource`) can't
 * reach it. This file builds its own per-fixture stream render, translating
 * each legacy-key fixture into the wire shapes the widget now reads:
 * `v.currentStage` -> `vessel.structure`; `dv.total*`/`dv.stageCount` ->
 * `dv.summary`; vessel-total resources -> `vessel.resources`; the current
 * stage's `r.resourceCurrent(Max)[X]` amounts injected as the matching
 * `dv.stages` entry's `resources` map so the `dv.currentStageResource(Max)`
 * derivation reproduces them. This is the same translation
 * `FuelStatus/dual-run.test.tsx` proved yields byte-identical DOM before that
 * transitional dual-run was retired.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/components exec vitest run src/FuelStatus/snapshots -u`.
 */
interface FuelFixture {
  "v.currentStage"?: number;
  "dv.stageCount"?: number;
  "dv.totalDVVac"?: number;
  "dv.totalDVASL"?: number;
  "dv.totalDVActual"?: number;
  "dv.totalBurnTime"?: number;
  "dv.stages"?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

const FIXTURES: Record<string, FuelFixture> = {
  "launchpad-full-tanks": launchpad as FuelFixture,
  "ascent-stage-drained": ascentDrained as FuelFixture,
  "asparagus-multi-stage": asparagus as FuelFixture,
  "lander-monoprop-only": lander as FuelFixture,
  "empty-ox-mid-burn": emptyOx as FuelFixture,
  "no-engine-data": noEngine as FuelFixture,
};

const RESOURCES = [
  "LiquidFuel",
  "Oxidizer",
  "MonoPropellant",
  "XenonGas",
  "ElectricCharge",
] as const;

const config = getWidget("fuel-status");
if (!config) throw new Error("fuel-status missing from widgets.ts");

function vesselResources(fx: FuelFixture): {
  resources: Record<string, { current: number; max: number }>;
} {
  const resources: Record<string, { current: number; max: number }> = {};
  for (const name of RESOURCES) {
    resources[name] = {
      current: (fx[`r.resource[${name}]`] as number) ?? 0,
      max: (fx[`r.resourceMax[${name}]`] as number) ?? 0,
    };
  }
  return { resources };
}

function stageResources(
  fx: FuelFixture,
): Record<string, { current: number; max: number }> {
  const out: Record<string, { current: number; max: number }> = {};
  for (const name of RESOURCES) {
    out[name] = {
      current: (fx[`r.resourceCurrent[${name}]`] as number) ?? 0,
      max: (fx[`r.resourceCurrentMax[${name}]`] as number) ?? 0,
    };
  }
  return out;
}

async function snapshotStream(
  fx: FuelFixture,
  mode: {
    name: string;
    w: number;
    h: number;
    config?: Record<string, unknown>;
  },
): Promise<string> {
  const streamFixture = setupStreamFixture({
    carriedChannels: [
      "vessel.structure",
      "vessel.resources",
      "dv.stages",
      "dv.summary",
    ],
    pinnedUt: 10,
  });
  streamFixture.store.registerDerivedChannel(dvCurrentStageResourceChannel);
  streamFixture.store.registerDerivedChannel(dvCurrentStageResourceMaxChannel);

  const { container } = render(
    <ThemeProvider theme={defaultDarkTheme}>
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
          <FuelStatusComponent
            config={mode.config ?? {}}
            id="snap"
            w={mode.w}
            h={mode.h}
          />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>
    </ThemeProvider>,
  );

  const currentStage = fx["v.currentStage"];
  const stages = (fx["dv.stages"] ?? []).map((s) =>
    s.stage === currentStage ? { ...s, resources: stageResources(fx) } : s,
  );

  act(() => {
    streamFixture.emit("vessel.structure", { currentStage });
    streamFixture.emit("vessel.resources", vesselResources(fx));
    streamFixture.emit("dv.summary", {
      stageCount: fx["dv.stageCount"],
      totalDvVac: fx["dv.totalDVVac"],
      totalDvAsl: fx["dv.totalDVASL"],
      totalDvActual: fx["dv.totalDVActual"],
      totalBurnTime: fx["dv.totalBurnTime"],
    });
    streamFixture.emit("dv.stages", stages);
  });

  await waitFor(() => {
    const point = streamFixture.store.sample(
      "vessel.structure",
      streamFixture.store.currentFrame(),
    );
    if (point?.payload === undefined) {
      throw new Error("vessel.structure has not resolved off the stream yet");
    }
  });

  return stripVolatile(container.innerHTML);
}

describe("FuelStatus DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotStream(fixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
