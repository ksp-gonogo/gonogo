import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FuelStatusComponent } from "./index";

/**
 * FuelStatus off the real stream pipeline, with no legacy `DataSource` registered. MonoPropellant, XenonGas and ElectricCharge read vessel totals off `vessel.resources` (wire shape `{ resources: { <name>: { current, max } }, meta }`); LiquidFuel and Oxidizer read stage-scoped channels this file does not feed, so they drop from the list.
 */
describe("FuelStatus: genuinely runs off the stream (M3 batch 1 + P4a dv.* migration)", () => {
  it("reads current stage + vessel-total resources off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.structure", "vessel.resources"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "fuel-stream" }}>
          <FuelStatusComponent id="fuel-stream" w={8} h={14} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(screen.getByText("FUEL · ΔV")).toBeTruthy();
    expect(screen.queryByText(/^Stage /)).not.toBeInTheDocument();

    // StubTransport.emit is subscription-gated, so a real subscription must exist.
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

    await waitFor(() => expect(visibleText()).toContain("Stage 2"));
    // XenonGas streams max 0 and is filtered out, exercising the "absent from the vessel" rule on real streamed data.
    expect(screen.getByRole("meter", { name: "RCS · vessel" })).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Power · vessel" })).toBeTruthy();
    // The meter writes the pair at one rung, with the unit once.
    expect(visibleText()).toContain("30.0 / 30.0 units");
    expect(visibleText()).toContain("150.0 / 200.0 units");
    expect(screen.queryByRole("meter", { name: /^Liquid Fuel/ })).toBeNull();
    expect(screen.queryByRole("meter", { name: /^Oxidizer/ })).toBeNull();
  });

  it("reads the ΔV totals + per-stage stack off dv.summary/dv.stages using the NEW StageDeltaVEntry wire shape", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.structure", "dv.stages", "dv.summary"],
      pinnedUt: 10,
      suspendFrames: true,
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
      // The mod's real StageDeltaVEntry field names, not the legacy `StageInfo` ones.
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

    await waitFor(() =>
      expect(screen.getByText(/^Stage 1/)).toBeInTheDocument(),
    );
    // Totals row: default mode is "actual".
    expect(visibleText()).toContain("3900 m/s");
    expect(visibleText()).toContain("2min 5s");
    // Per-stage ΔV (actual column) for both rows.
    expect(visibleText()).toContain("2300 m/s");
    expect(visibleText()).toContain("1600 m/s");
  });
});
