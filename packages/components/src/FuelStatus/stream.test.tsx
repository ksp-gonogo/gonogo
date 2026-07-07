import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FuelStatusComponent } from "./index";

/**
 * The M3 batch-1 stream test-adapter proof for FuelStatus (mirrors
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
 *   variant instead (below).
 * - GAPPED (stay legacy forever until a gap lands — not exercised here
 *   since no legacy source exists in this file): `dv.stageCount`/
 *   `dv.totalDV*`/`dv.totalBurnTime`/`dv.stages` (the whole ΔV/stage-sim
 *   family, G-14) and `r.resourceCurrent(Max)[X]` (STAGE-scoped, which is
 *   what LiquidFuel/Oxidizer actually read) — so those two resources render
 *   as absent (`max > 0` filter drops them from the list) even once the
 *   vessel-total resources stream.
 *
 * `vessel.resources`'s wire shape is `{ resources: { <name>: {current,
 * max} }, meta }` — the extra nesting the M3 batch-1 fix added to
 * `mapTopic`'s resource regex (see `map-topic.ts`'s doc comment); this
 * fixture reproduces that real shape rather than the flatter one a naive
 * reading of the old (buggy) mapping would suggest.
 */
afterEach(() => {
  cleanup();
});

describe("FuelStatus — genuinely runs off the stream (M3 batch 1)", () => {
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
});
