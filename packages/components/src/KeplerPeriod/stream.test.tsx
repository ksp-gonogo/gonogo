import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KeplerPeriodComponent } from "./index";

// Unmounted before clearBodies(), which would otherwise notify a mounted tree outside act().
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

function unmountAll() {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
}

beforeEach(() => {
  clearBodies();
  registerStockBodies();
});

afterEach(() => {
  unmountAll();
  clearBodies();
});

const KEPLER_PERIOD_CHANNELS = [
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
];

describe("KeplerPeriod: reads body names off the stream", () => {
  it("resolves the parent and reference body names off the stream and surfaces the no-reference-data notice", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: KEPLER_PERIOD_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "kepler-stream" }}>
          <KeplerPeriodComponent id="kepler-stream" w={10} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(screen.getByText("KEPLER PERIOD")).toBeTruthy();
    expect(screen.queryByText(/No reference data/)).toBeNull();

    // A streamed body with a radius and no gravitational parameter resolves, but cannot carry a curve.
    act(() => {
      fixture.emit("vessel.orbit", {
        sma: 682500,
        ecc: 0.00367,
        inc: 0.3,
        argPe: 12.5,
        mu: 3.5316e12,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        referenceBodyIndex: 42,
      });
      fixture.emit("vessel.identity", {
        parentBodyIndex: 42,
        launchUt: 0,
      });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Gallium",
            index: 42,
            parentIndex: 0,
            radius: 100000,
            orbit: null,
          },
        ],
      });
    });

    expect(fixture.transport.isSubscribed("vessel.identity")).toBe(true);
    expect(fixture.transport.isSubscribed("system.bodies")).toBe(true);

    await waitFor(() =>
      expect(screen.getByText(/No reference data/)).toBeTruthy(),
    );
    expect(screen.getByText(/Gallium/)).toBeTruthy();
  });
});
