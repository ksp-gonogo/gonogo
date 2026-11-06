import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KeplerPeriodComponent } from "./index";

let restoreObserver: () => void;

beforeEach(() => {
  clearBodies();
  registerStockBodies();
  restoreObserver = installFixedSizeResizeObserver({ width: 900, height: 700 });
});

afterEach(() => {
  restoreObserver();
});

function mount(fixture: ReturnType<typeof setupStreamFixture>) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "kepler-open" }}>
        <KeplerPeriodComponent id="kepler-open" w={10} h={8} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

function emitKnownCraft(
  fixture: ReturnType<typeof setupStreamFixture>,
  withOrbit: boolean,
) {
  act(() => {
    fixture.emit("trackingStation.bodies", {
      bodies: [
        { name: "Mun", index: 2, radius: 200000, gravParameter: 6.5138398e10 },
      ],
    });
    fixture.emit("vessel.identity", {
      vesselId: "v1",
      name: "Mun Probe",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: 2,
    });
    fixture.emit("trackingStation.catalog", {
      entries: [
        {
          vesselId: "v1",
          name: "Mun Probe",
          vesselType: 0,
          situation: 3,
          bodyIndex: 2,
          orbit: withOrbit
            ? {
                sma: 260000,
                ecc: 0.001,
              }
            : null,
        },
      ],
    });
  });
}

describe("KeplerPeriod: opened during a blackout", () => {
  it("shows the held period from the catalog's orbit, never a waiting message", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    mount(fixture);
    emitKnownCraft(fixture, true);
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Orbital period\s*54/),
    );
    expect(document.body.textContent).not.toMatch(/Waiting for data/);
    await act(async () => {});
  });

  it("keeps the existing empty state when the catalog has no orbit for the craft", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    mount(fixture);
    emitKnownCraft(fixture, false);
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/No orbit reported/),
    );
    expect(document.body.textContent).not.toMatch(/Orbital period\s*\d/);
    await act(async () => {});
  });

  it("shows the held period when the orbit was held before this widget opened, never a waiting message", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    mount(fixture);
    emitKnownCraft(fixture, true);
    act(() => {
      fixture.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 2,
          sma: 260000,
          ecc: 0.001,
          inc: 0.3,
          lan: 0,
          argPe: 12.5,
          mu: 6.5138398e10,
          horizon: ANALYTIC_UNBOUNDED_HORIZON,
          meanAnomalyAtEpoch: 0,
          epoch: 10,
        },
        { quality: Quality.OnRails },
      );
    });
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    act(() => {
      fixture.scrubTo(500);
    });
    await waitFor(() =>
      expect(fixture.store.sampleReading("vessel.orbit").state).toBe("held"),
    );
    document.body.replaceChildren();
    mount(fixture);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Orbital period\s*54/),
    );
    expect(document.body.textContent).not.toMatch(/Waiting for data/);
    await act(async () => {});
  });
});
