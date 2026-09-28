import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KeplerPeriodComponent } from "./index";

const KEPLER_PERIOD_CHANNELS = [
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
];

describe("KeplerPeriodComponent", () => {
  let restoreResizeObserver: () => void = () => {};
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    clearBodies();
    registerStockBodies();
    restoreResizeObserver = installFixedSizeResizeObserver({
      width: 400,
      height: 300,
    });
    stream = setupStreamFixture({
      carriedChannels: KEPLER_PERIOD_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    clearBodies();
    restoreResizeObserver();
    vi.unstubAllGlobals();
  });

  function renderKepler() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "kepler-test" }}>
          <KeplerPeriodComponent config={{}} id="kepler-test" />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  it("draws the Kepler curve once a known body is selected", async () => {
    const { container } = renderKepler();

    act(() => {
      stream.emit("system.bodies", {
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
      stream.emit("vessel.orbit", {
        referenceBodyIndex: 1,
        sma: 700000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: 3.5316e12,
      });
      stream.emit("vessel.identity", { parentBodyIndex: null, launchUt: null });
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
  });

  it("falls back to the parent body when the orbit names no reference body", async () => {
    const { container } = renderKepler();

    act(() => {
      stream.emit("system.bodies", {
        bodies: [
          {
            name: "Mun",
            index: 2,
            parentIndex: 1,
            radius: 200000,
            orbit: null,
          },
        ],
      });
      // An unresolvable reference body index falls back to the parent body.
      stream.emit("vessel.orbit", {
        referenceBodyIndex: 999,
        sma: 700000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: 3.5316e12,
      });
      stream.emit("vessel.identity", { parentBodyIndex: 2, launchUt: null });
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
  });

  // Radius and gravitational parameter come from the streamed roster, so a planet-pack body still draws.
  it("draws the curve for a body the stock table has never heard of", async () => {
    const { container } = renderKepler();

    act(() => {
      stream.emit("system.bodies", {
        bodies: [
          {
            name: "Earth",
            index: 1,
            parentIndex: 0,
            radius: 6_371_000,
            gravParameter: 3.986004418e14,
            orbit: null,
          },
        ],
      });
      stream.emit("vessel.orbit", {
        referenceBodyIndex: 1,
        sma: 6_771_000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: 3.986004418e14,
      });
      stream.emit("vessel.identity", { parentBodyIndex: 1, launchUt: null });
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/Unknown body/)).toBeNull();
    expect(screen.queryByText(/No reference data/)).toBeNull();
  });
});
