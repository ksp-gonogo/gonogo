import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import launchpad from "./__fixtures__/launchpad-full-tanks.json";
import { FuelStatusComponent } from "./index";

/**
 * FuelStatus's M3 batch-1 behavior-preservation golden dual-run (mirrors
 * `WarpControl/dual-run.test.tsx`, the pilot): the SAME fuel/stage state,
 * rendered once off the legacy `DataSource` and once off the stream, must
 * produce byte-identical DOM at `delay=0`.
 *
 * `launchpad-full-tanks` is chosen because every one of its 5 resources is
 * present (max > 0), exercising all 5 resource rows — 3 read the MAPPED
 * vessel-total keys off the stream (MonoPropellant/XenonGas/
 * ElectricCharge), 2 read the GAPPED stage-scoped keys off a legacy AUX
 * source (LiquidFuel/Oxidizer, per `useResourceReading`'s `scope:
 * "current"`) — plus `v.currentStage` (MAPPED). This is the widest MIXED-
 * source shape of the batch-1 three: two DIFFERENT resource scopes
 * coexisting with the legacy DataSource on the very same render, on top of
 * the mapped/gapped split every other widget's dual-run already proves.
 *
 * The whole ΔV/stage-stack family (`dv.stageCount`/`dv.totalDV*`/
 * `dv.totalBurnTime`/`dv.stages`) was UN-GAPPED in the P4a shared-map batch
 * (G-14) and now streams too — its leg hand-translates the fixture's
 * legacy-shape `dv.stages` entries into the new `StageDeltaVEntry` field
 * names (`dvVac`/`dvAsl`/`dvActual`/`twrVac`/`twrAsl`/`twrActual`/
 * `thrustAsl`) and proves `parseStages` (index.tsx) reconciles both shapes
 * to an identical render, same "shape fix" proof ScienceOfficer's dual-run
 * establishes for `parseInstruments`.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = [
  "r.resourceCurrent[LiquidFuel]",
  "r.resourceCurrentMax[LiquidFuel]",
  "r.resourceCurrent[Oxidizer]",
  "r.resourceCurrentMax[Oxidizer]",
  "r.resourceCurrent[MonoPropellant]",
  "r.resourceCurrentMax[MonoPropellant]",
  "r.resourceCurrent[XenonGas]",
  "r.resourceCurrentMax[XenonGas]",
  "r.resourceCurrent[ElectricCharge]",
  "r.resourceCurrentMax[ElectricCharge]",
] as const;

describe("FuelStatus — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same fuel/stage state", async () => {
    const mode = { name: "default-8x14", w: 8, h: 14 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: FuelStatusComponent,
      fixture: launchpad,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: [
        "vessel.structure",
        "vessel.resources",
        "dv.stages",
        "dv.summary",
      ],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: GAPPED_KEYS.map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "fuel-dual" }}>
          <FuelStatusComponent id="fuel-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(key, launchpad[key as keyof typeof launchpad]);
      }
      streamFixture.emit("vessel.structure", {
        currentStage: launchpad["v.currentStage"],
      });
      streamFixture.emit("vessel.resources", {
        resources: {
          LiquidFuel: {
            current: launchpad["r.resource[LiquidFuel]"],
            max: launchpad["r.resourceMax[LiquidFuel]"],
          },
          Oxidizer: {
            current: launchpad["r.resource[Oxidizer]"],
            max: launchpad["r.resourceMax[Oxidizer]"],
          },
          MonoPropellant: {
            current: launchpad["r.resource[MonoPropellant]"],
            max: launchpad["r.resourceMax[MonoPropellant]"],
          },
          XenonGas: {
            current: launchpad["r.resource[XenonGas]"],
            max: launchpad["r.resourceMax[XenonGas]"],
          },
          ElectricCharge: {
            current: launchpad["r.resource[ElectricCharge]"],
            max: launchpad["r.resourceMax[ElectricCharge]"],
          },
        },
      });
      streamFixture.emit("dv.summary", {
        stageCount: launchpad["dv.stageCount"],
        totalDvVac: launchpad["dv.totalDVVac"],
        totalDvAsl: launchpad["dv.totalDVASL"],
        totalDvActual: launchpad["dv.totalDVActual"],
        totalBurnTime: launchpad["dv.totalBurnTime"],
      });
      // Same stage values as the legacy fixture, translated into the new
      // StageDeltaVEntry wire shape (dvVac/dvAsl/dvActual/twrVac/twrAsl/
      // twrActual/thrustAsl instead of deltaVVac/deltaVASL/deltaVActual/
      // TWRVac/TWRASL/TWRActual/thrustASL) — proves parseStages reconciles
      // both shapes to the same rendered output.
      streamFixture.emit(
        "dv.stages",
        launchpad["dv.stages"].map((s) => ({
          stage: s.stage,
          stageMass: s.stageMass,
          dryMass: s.dryMass,
          fuelMass: s.fuelMass,
          startMass: s.startMass,
          endMass: s.endMass,
          burnTime: s.burnTime,
          dvVac: s.deltaVVac,
          dvAsl: s.deltaVASL,
          dvActual: s.deltaVActual,
          twrVac: s.TWRVac,
          twrAsl: s.TWRASL,
          twrActual: s.TWRActual,
          ispVac: s.ispVac,
          ispASL: s.ispASL,
          ispActual: s.ispActual,
          thrustVac: s.thrustVac,
          thrustAsl: s.thrustASL,
          thrustActual: s.thrustActual,
        })),
      );
    });

    // Stage stack ("S2"/"S1"/"S0" labels) is now stream-fed (dv.stages) —
    // wait on it alongside a resource-bar value to prove both the ΔV/stage
    // family and the mapped resources/currentStage have landed.
    await waitFor(() => {
      if (!container.textContent?.includes("Stage 2")) {
        throw new Error("stream leg has not rendered currentStage yet");
      }
      if (!container.textContent?.includes("200.0")) {
        throw new Error("stream leg has not rendered resources yet");
      }
      if (!container.textContent?.includes("S0")) {
        throw new Error("stream leg has not rendered the stage stack yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
