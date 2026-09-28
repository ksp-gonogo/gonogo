import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { FuelStatusComponent } from "../FuelStatus/index";
import { SystemViewComponent } from "../SystemView/index";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";

/**
 * Two providers on one page, as a docs page, Storybook or the app's own
 * modal bridge mounts them. Each evaluates its processors against its own
 * store, and unmounting either leaves the other evaluating.
 */

function dvFixture(): StreamFixture {
  return setupStreamFixture({
    pinnedUt: 100,
    suspendFrames: true,
  });
}

function systemFixture(): StreamFixture {
  return setupStreamFixture({
    pinnedUt: 100,
    suspendFrames: true,
  });
}

function feedDeltaV(fixture: StreamFixture, dvActual: number): void {
  act(() => {
    fixture.emit("vessel.structure", { currentStage: 0 });
    fixture.emit("dv.summary", {
      stageCount: 1,
      totalDvVac: dvActual + 300,
      totalDvAsl: dvActual - 100,
      totalDvActual: dvActual,
      totalBurnTime: 60,
    });
    fixture.emit("dv.stages", [
      {
        stage: 0,
        dvVac: dvActual + 300,
        dvAsl: dvActual - 100,
        dvActual,
        burnTime: 60,
        twrVac: 1.5,
        twrAsl: 1.2,
        twrActual: 1.3,
        thrustVac: 200,
        thrustAsl: 180,
        thrustActual: 190,
        startMass: 5,
        endMass: 2,
        dryMass: 2,
        fuelMass: 3,
      },
    ]);
  });
}

function feedKerbin(fixture: StreamFixture, radius: number): void {
  act(() => {
    fixture.emit("system.bodies", {
      bodies: [
        {
          index: 0,
          name: "Kerbin",
          parentIndex: null,
          radius,
          gravParameter: 3.5316e12,
          orbit: null,
        },
      ],
    });
    fixture.emit("vessel.identity", {
      vesselId: "v",
      name: "Tester",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: 0,
    });
  });
}

function mountBoth() {
  const fuel = dvFixture();
  const system = systemFixture();
  const fuelView = render(
    <fuel.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "fuel-a" }}>
        <FuelStatusComponent id="fuel-a" w={8} h={14} />
      </DashboardItemContext.Provider>
    </fuel.Provider>,
  );
  const systemView = render(
    <system.Provider>
      <SystemViewComponent config={{ frame: "Kerbin" }} id="sv-b" />
      <DashboardItemContext.Provider value={{ instanceId: "fuel-b" }}>
        <FuelStatusComponent id="fuel-b" w={8} h={14} />
      </DashboardItemContext.Provider>
    </system.Provider>,
  );
  return { fuel, system, fuelView, systemView };
}

describe("processors under two providers on one page", () => {
  it("computes each provider's processors from its own data", async () => {
    const { fuel, system, fuelView, systemView } = mountBoth();

    feedDeltaV(fuel, 3900);
    feedDeltaV(system, 1600);
    feedKerbin(system, 600_000);

    await waitFor(() =>
      expect(visibleText(fuelView.container)).toContain("3900 m/s"),
    );
    await waitFor(() =>
      expect(visibleText(systemView.container)).toContain("1600 m/s"),
    );
    await waitFor(() =>
      expect(visibleText(systemView.container)).toContain("600.0 km"),
    );
    expect(visibleText(fuelView.container)).not.toContain("1600 m/s");
    expect(visibleText(systemView.container)).not.toContain("3900 m/s");
  });

  it("keeps the earlier provider evaluating after the later one unmounts", async () => {
    const { fuel, system, fuelView, systemView } = mountBoth();
    feedDeltaV(fuel, 3900);
    feedDeltaV(system, 1600);
    await waitFor(() =>
      expect(visibleText(fuelView.container)).toContain("3900 m/s"),
    );

    systemView.unmount();
    feedDeltaV(fuel, 4100);

    await waitFor(() =>
      expect(visibleText(fuelView.container)).toContain("4100 m/s"),
    );
  });

  it("keeps the later provider evaluating after the earlier one unmounts", async () => {
    const { fuel, system, fuelView, systemView } = mountBoth();
    feedDeltaV(fuel, 3900);
    feedDeltaV(system, 1600);
    feedKerbin(system, 600_000);
    await waitFor(() =>
      expect(visibleText(systemView.container)).toContain("1600 m/s"),
    );

    fuelView.unmount();
    feedDeltaV(system, 1200);
    feedKerbin(system, 700_000);

    await waitFor(() =>
      expect(visibleText(systemView.container)).toContain("1200 m/s"),
    );
    await waitFor(() =>
      expect(visibleText(systemView.container)).toContain("700.0 km"),
    );
  });
});
