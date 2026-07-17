import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FuelStatusComponent } from "./index";

/**
 * The stream test-adapter proof for FuelStatus (mirrors
 * `WarpControl/stream.test.tsx`, the pilot): genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport` — no legacy `DataSource` is registered anywhere in this
 * file.
 *
 * FuelStatus's keys split MAPPED / GAPPED (`map-topic.ts`):
 * - MAPPED: `v.currentStage` -> `vessel.structure.currentStage`;
 *   `r.resource[X]`/`r.resourceMax[X]` (vessel-TOTAL) -> `vessel.resources.
 *   resources.<X>.{current,max}` — but only 3 of the 5 catalogued resources
 *   (MonoPropellant, XenonGas, ElectricCharge) are read at `scope:"vessel"`
 *   by `useResourceReading`; LiquidFuel/Oxidizer read the STAGE-scoped
 *   variant instead (below). Also MAPPED:
 *   `dv.stages` -> whole-topic `dv.stages` (a `StageDeltaVEntry[]`, a
 *   DIFFERENT field-name shape to the legacy `StageInfo` — `parseStages` in
 *   `index.tsx` reconciles it, exercised below) and `dv.stageCount`/
 *   `dv.totalDV*`/`dv.totalBurnTime` -> raw-field walks on the sibling
 *   `dv.summary` topic.
 * - GAPPED (stays legacy forever until a gap lands — not exercised here
 *   since no legacy source exists in this file): `r.resourceCurrent(Max)[X]`
 *   (STAGE-scoped, which is what LiquidFuel/Oxidizer actually read) — so
 *   those two resources render as absent (`max > 0` filter drops them from
 *   the list) even once everything else streams.
 *
 * `vessel.resources`'s wire shape is `{ resources: { <name>: {current,
 * max} }, meta }` — the extra nesting that fix added to
 * `mapTopic`'s resource regex (see `map-topic.ts`'s doc comment); this
 * fixture reproduces that real shape rather than the flatter one a naive
 * reading of the old (buggy) mapping would suggest.
 */
describe("FuelStatus — genuinely runs off the stream (M3 batch 1 + P4a dv.* migration)", () => {
  it("reads current stage + vessel-total resources off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.structure", "vessel.resources"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "fuel-stream" }}>
          <FuelStatusComponent id="fuel-stream" w={8} h={14} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet — every mapped/gapped key is undefined, so no
    // resource row or stage subtitle has anything to render.
    expect(screen.getByText("FUEL · ΔV")).toBeTruthy();
    expect(screen.queryByText(/^Stage /)).not.toBeInTheDocument();

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.structure")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.resources")).toBe(true);

    act(() => {
      fixture.emit("vessel.structure", { currentStage: 2 });
      fixture.emit("vessel.resources", {
        resources: {
          MonoPropellant: { current: 30, max: 30 },
          XenonGas: { current: 0, max: 0 },
          ElectricCharge: { current: 150, max: 200 },
        },
      });
    });

    await waitFor(() => expect(screen.getByText("Stage 2")).toBeTruthy());
    // MonoPropellant (RCS) and ElectricCharge (Power) both stream a
    // positive max and render; XenonGas's max === 0 so it's filtered out —
    // exercising the widget's own "resources absent from the vessel are
    // skipped" rule off REAL streamed data, not a fixture shortcut.
    expect(screen.getByText("RCS")).toBeTruthy();
    expect(screen.getByText("Power")).toBeTruthy();
    // formatAmount: <100 -> 2 decimals, >=100 -> 1 decimal.
    expect(screen.getByText("30.00 / 30.00")).toBeTruthy();
    expect(screen.getByText("150.0 / 200.0")).toBeTruthy();
    // LiquidFuel/Oxidizer read the GAPPED stage-scoped keys — with no
    // legacy source in this file they never arrive, so max stays 0 and
    // they're filtered out of the resource list exactly like XenonGas.
    expect(screen.queryByText("Liquid Fuel")).not.toBeInTheDocument();
    expect(screen.queryByText("Oxidizer")).not.toBeInTheDocument();
  });

  it("reads the ΔV totals + per-stage stack off dv.summary/dv.stages using the NEW StageDeltaVEntry wire shape", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.structure", "dv.stages", "dv.summary"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "fuel-dv-stream" }}>
          <FuelStatusComponent id="fuel-dv-stream" w={8} h={14} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("dv.stages")).toBe(true);
    expect(fixture.transport.isSubscribed("dv.summary")).toBe(true);

    act(() => {
      fixture.emit("vessel.structure", { currentStage: 1 });
      fixture.emit("dv.summary", {
        stageCount: 2,
        totalDvVac: 4200,
        totalDvAsl: 3800,
        totalDvActual: 3900,
        totalBurnTime: 125,
      });
      // The mod's real StageDeltaVEntry field names (contract.ts:491) —
      // `dvVac`/`dvAsl`/`dvActual`/`twrVac`/`twrAsl`/`twrActual`/`thrustAsl`,
      // NOT the legacy `StageInfo` names. Proves `parseStages` reads the
      // new wire, not just the old shape `index.test.tsx` covers.
      fixture.emit("dv.stages", [
        {
          stage: 1,
          dvVac: 2500,
          dvAsl: 2100,
          dvActual: 2300,
          burnTime: 72,
          twrVac: 1.45,
          twrAsl: 1.2,
          twrActual: 1.3,
          thrustVac: 400,
          thrustAsl: 340,
          thrustActual: 360,
          startMass: 8.4,
          endMass: 2.1,
          dryMass: 2.1,
          fuelMass: 6.3,
        },
        {
          stage: 0,
          dvVac: 1700,
          dvAsl: 1500,
          dvActual: 1600,
          burnTime: 53,
          twrVac: 1.9,
          twrAsl: 1.6,
          twrActual: 1.75,
          thrustVac: 33,
          thrustAsl: 30,
          thrustActual: 30,
          startMass: 2.8,
          endMass: 1.0,
          dryMass: 1.0,
          fuelMass: 1.8,
        },
      ]);
    });

    await waitFor(() => expect(screen.getByText(/^Stage 1/)).toBeTruthy());
    // Totals row: default mode is "actual".
    expect(screen.getByText("3900 m/s")).toBeTruthy();
    expect(screen.getByText("2m 5s")).toBeTruthy();
    // Per-stage ΔV (actual column) for both rows.
    expect(screen.getByText("2300 m/s")).toBeTruthy();
    expect(screen.getByText("1600 m/s")).toBeTruthy();
  });
});
