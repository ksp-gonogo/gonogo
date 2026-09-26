import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, render as rtlRender, waitFor } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

let restoreResizeObserver: () => void = () => {};

beforeEach(() => {
  clearBodies();
  registerStockBodies();
  restoreResizeObserver = installFixedSizeResizeObserver({
    width: 400,
    height: 300,
  });
});

afterEach(() => {
  unmountAll();
  clearBodies();
  // installFixedSizeResizeObserver assigns the global directly, so unstubAllGlobals does not restore it.
  restoreResizeObserver();
  vi.unstubAllGlobals();
});

const KEPLER_PERIOD_CHANNELS = [
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
];

describe("KeplerPeriod: renders the reference curve off the stream", () => {
  it("draws the Kepler curve once a known reference body streams in", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: KEPLER_PERIOD_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "kepler-dual" }}>
          <KeplerPeriodComponent id="kepler-dual" w={10} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Both body indices point at Kerbin (stock index 1), whose definition carries a gm.
    act(() => {
      fixture.emit("vessel.orbit", {
        sma: 680000,
        ecc: 0.0,
        inc: 0.0,
        argPe: 0.0,
        mu: 3.5316e12,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        referenceBodyIndex: 1,
      });
      fixture.emit("vessel.identity", { parentBodyIndex: 1, launchUt: 0 });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: 600000,
            orbit: null,
          },
        ],
      });
    });

    // StubTransport delivers only to subscribed channels.
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
    expect(container.textContent).not.toContain("Unknown body");
    expect(container.textContent).not.toContain("No reference data");
  });
});
