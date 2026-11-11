import "./chargeRate";
import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { PowerSystemsComponent } from "./index";

/** A crewed pod with nothing but its battery: no part reports a flow. */
function batteryOnly(amount: number) {
  return {
    parts: [
      {
        id: "1",
        name: "mk1pod",
        title: "Mk1 Command Pod",
        position: { x: 0, y: 0, z: 0 },
        bounds: { size: { x: 1, y: 1, z: 1 } },
        dryMass: 0.8,
        inverseStage: 0,
        maxTemp: 1200,
        category: "Pods",
        modules: [],
        isRobotics: false,
        isPowerRelated: false,
        resources: { ElectricCharge: { amount, maxAmount: 140 } },
        moduleStates: [],
      },
    ],
  };
}

/** Reports observed at the UT the fixture pins its clock to. */
const AT_1000 = { validAt: 1000, deliveredAt: 1000 };

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts) unmount();
  unmounts.length = 0;
  clearActionHandlers();
});

function mount(size: { w: number; h: number } = { w: 8, h: 12 }) {
  const fixture = setupStreamFixture({ pinnedUt: 1000, suspendFrames: true });
  const { container, unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "power-predict" }}>
        <PowerSystemsComponent id="power-predict" w={size.w} h={size.h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  unmounts.push(unmount);
  return { fixture, container };
}

/** The craft's own clock, which runs on while the stream is cut. */
function later(
  fixture: ReturnType<typeof setupStreamFixture>,
  seconds: number,
) {
  act(() => {
    fixture.wall.advanceBy(seconds);
    fixture.emitFrame();
  });
}

function cut(fixture: ReturnType<typeof setupStreamFixture>) {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

describe("PowerSystems predicts the end of the charge", () => {
  it("gives a battery-only craft its net rate and a time to empty from the stored charge alone", async () => {
    const { fixture, container } = mount();
    act(() => {
      fixture.emit("vessel.parts", batteryOnly(18), AT_1000);
      fixture.emit("parts.power", { netChargeRateEc: -0.04 }, AT_1000);
    });
    await waitFor(() => expect(visibleText(container)).toMatch(/Empty in 7/i));
    expect(visibleText(container)).toContain("-0.04");
  });

  it("draws no no-flow line and no empty producer or consumer list when only the net is measured", async () => {
    const { fixture, container } = mount();
    act(() => {
      fixture.emit("vessel.parts", batteryOnly(80), AT_1000);
      fixture.emit("parts.power", { netChargeRateEc: -0.1 }, AT_1000);
    });
    await waitFor(() => expect(visibleText(container)).toMatch(/Empty in/i));
    expect(visibleText(container)).not.toMatch(/No active/);
    expect(visibleText(container)).not.toMatch(/Nothing (producing|consuming)/);
  });

  it("reads a store at zero as empty", async () => {
    const { fixture, container } = mount();
    act(() => {
      fixture.emit("vessel.parts", batteryOnly(0), AT_1000);
      fixture.emit("parts.power", { netChargeRateEc: null }, AT_1000);
    });
    await waitFor(() => expect(visibleText(container)).toMatch(/Empty/));
    expect(visibleText(container)).not.toMatch(/Empty in/i);
  });

  it("carries a held report forward and marks the figures held and modelled", async () => {
    const { fixture, container } = mount();
    act(() => {
      fixture.emit("vessel.parts", batteryOnly(31.2), AT_1000);
      fixture.emit("parts.power", { netChargeRateEc: -0.04 }, AT_1000);
    });
    await waitFor(() => expect(visibleText(container)).toMatch(/Empty in/i));
    cut(fixture);
    later(fixture, 60);
    await waitFor(() =>
      expect(visibleText(container)).toMatch(/Held · last report/i),
    );
    expect(visibleText(container)).toMatch(/Empty in ~/i);
    expect(
      container.querySelector('[data-reckoning-mark="modelled"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-held]")).not.toBeNull();
  });

  it("says likely empty once the held report's drain has run past zero", async () => {
    const { fixture, container } = mount();
    act(() => {
      fixture.emit("vessel.parts", batteryOnly(2), AT_1000);
      fixture.emit("parts.power", { netChargeRateEc: -0.04 }, AT_1000);
    });
    await waitFor(() => expect(visibleText(container)).toMatch(/Empty in/i));
    cut(fixture);
    later(fixture, 200);
    await waitFor(() =>
      expect(visibleText(container)).toMatch(/Likely empty/i),
    );
  });

  it("shows only the net rate and the time to empty at the smallest size", async () => {
    const { fixture, container } = mount({ w: 4, h: 3 });
    act(() => {
      fixture.emit("vessel.parts", batteryOnly(18), AT_1000);
      fixture.emit("parts.power", { netChargeRateEc: -0.04 }, AT_1000);
    });
    await waitFor(() => expect(visibleText(container)).toMatch(/empty in/i));
    expect(visibleText(container)).toContain("-0.04");
    expect(visibleText(container)).not.toMatch(/PROD|CONS/);
  });
});
