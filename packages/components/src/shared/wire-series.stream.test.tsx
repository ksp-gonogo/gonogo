import { DashboardItemContext } from "@ksp-gonogo/core";
import { PRODUCTION_DERIVED_CHANNELS } from "@ksp-gonogo/sitrep-client";
import { act, render, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeplerPeriodComponent } from "../KeplerPeriod";
import { OrbitalAscentComponent } from "../OrbitalAscent";
import { TwrComponent } from "../Twr";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { useComputedSeries } from "./useComputedSeries";

/**
 * Three plotted quantities the wire does not carry, each computed at the point
 * of read from fields it does, and each drawn with NO client-derived channel in
 * the store.
 *
 * A graph addresses its series by string, so a compiler cannot see one. When a
 * derived channel is deleted, an address on it resolves to a topic nothing
 * publishes and the chart draws an empty series with no error anywhere. Every
 * case here therefore runs with every production derived channel left out of
 * the store, and fails as exactly that empty chart if its series has gone onto
 * one.
 *
 * The operands VARY across the three samples on purpose. A constant operand
 * would let a series pass while computing nothing from it.
 */
function stubSizedResizeObserver() {
  vi.stubGlobal(
    "ResizeObserver",
    class FakeResizeObserver implements ResizeObserver {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(_el: Element) {
        this.cb(
          [{ contentRect: { width: 400, height: 300 } } as ResizeObserverEntry],
          this,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

function fixtureWithoutDerivedChannels(carried: string[]) {
  return setupStreamFixture({
    carriedChannels: carried,
    pinnedUt: 10,
    suspendFrames: true,
    withoutDerivedChannels: PRODUCTION_DERIVED_CHANNELS.map((c) => c.topic),
  });
}

const PLOTTED_LINE =
  'svg[aria-label="Telemetry line chart"] path[d][fill="none"]';

describe("series computed from the wire, with no derived channel in the store", () => {
  beforeEach(stubSizedResizeObserver);
  afterEach(() => vi.unstubAllGlobals());

  it("KeplerPeriod still marks the current orbit", async () => {
    const fixture = fixtureWithoutDerivedChannels(["vessel.orbit"]);
    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "kp-wire" }}>
          <KeplerPeriodComponent config={{}} id="kp-wire" />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    expect(container.querySelector("svg circle")).toBeNull();

    act(() => {
      for (const [validAt, sma] of [
        [-200, 679_400],
        [-100, 679_800],
        [10, 680_000],
      ]) {
        fixture.emit("vessel.orbit", { sma, mu: 3.5316e12 }, { validAt });
      }
    });

    await waitFor(() => {
      expect(container.querySelectorAll("svg circle").length).toBeGreaterThan(
        0,
      );
    });
  });

  it("OrbitalAscent still draws the horizontal-speed trace", async () => {
    const fixture = fixtureWithoutDerivedChannels(["vessel.flight"]);
    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "oa-wire" }}>
          <OrbitalAscentComponent config={{}} id="oa-wire" />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    expect(container.querySelector(PLOTTED_LINE)).toBeNull();

    act(() => {
      for (const [validAt, altitudeAsl, surfaceSpeed, verticalSpeed] of [
        [-200, 1_000, 150, 140],
        [-100, 8_000, 600, 400],
        [10, 20_000, 1_400, 300],
      ]) {
        fixture.emit(
          "vessel.flight",
          { altitudeAsl, surfaceSpeed, verticalSpeed },
          { validAt },
        );
      }
    });

    await waitFor(() => {
      const d = container.querySelector(PLOTTED_LINE)?.getAttribute("d") ?? "";
      expect(d.match(/L/g)?.length).toBe(2);
    });
  });

  it("Twr still draws its sparkline", async () => {
    const fixture = fixtureWithoutDerivedChannels(["vessel.propulsion"]);
    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "twr-wire" }}>
          <TwrComponent config={{}} id="twr-wire" w={6} h={6} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      for (const [validAt, currentThrust, totalMass] of [
        [-40, 200, 20],
        [-20, 260, 18],
        [10, 300, 15],
      ]) {
        fixture.emit(
          "vessel.propulsion",
          { currentThrust, totalMass },
          { validAt },
        );
      }
    });

    await waitFor(() => {
      const paths = Array.from(container.querySelectorAll("svg path[d]"));
      expect(paths.some((p) => /L/.test(p.getAttribute("d") ?? ""))).toBe(true);
    });
  });
});

describe("useComputedSeries", () => {
  it("combines each primary sample with the secondary's value at or before it", async () => {
    const fixture = fixtureWithoutDerivedChannels(["vessel.propulsion"]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <fixture.Provider>{children}</fixture.Provider>
    );
    const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
    const { result } = renderHook(
      () =>
        useComputedSeries(
          "vessel.propulsion.currentThrust",
          "vessel.propulsion.totalMass",
          300,
          ratio,
        ),
      { wrapper },
    );

    act(() => {
      fixture.emit(
        "vessel.propulsion",
        { currentThrust: 100, totalMass: 20 },
        { validAt: -20 },
      );
      fixture.emit(
        "vessel.propulsion",
        { currentThrust: 90, totalMass: 0 },
        { validAt: -10 },
      );
      fixture.emit(
        "vessel.propulsion",
        { currentThrust: 60, totalMass: 12 },
        { validAt: 10 },
      );
    });

    // The middle sample's zero mass answers null and is dropped, as a
    // non-numeric fetched sample is.
    await waitFor(() => {
      expect(result.current.v).toEqual([5, 5]);
    });
  });
});
