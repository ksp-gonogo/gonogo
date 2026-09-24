import { execFileSync } from "node:child_process";
import { DashboardItemContext } from "@ksp-gonogo/core";
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
 * of read from fields it does, and each drawn with `vessel.state` ABSENT.
 *
 * A graph addresses its series by string, so a compiler cannot see one. When a
 * derived channel is deleted, an address on it resolves to a topic nothing
 * publishes and the chart draws an empty series with no error anywhere. Every
 * case here therefore runs with that channel left out of the store, and fails
 * as exactly that empty chart if its series has gone back onto it.
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

function fixtureWithoutVesselState(carried: string[]) {
  return setupStreamFixture({
    carriedChannels: carried,
    pinnedUt: 10,
    suspendFrames: true,
    withoutDerivedChannels: ["vessel.state"],
  });
}

const PLOTTED_LINE =
  'svg[aria-label="Telemetry line chart"] path[d][fill="none"]';

describe("series computed from the wire, with vessel.state gone", () => {
  beforeEach(stubSizedResizeObserver);
  afterEach(() => vi.unstubAllGlobals());

  it("KeplerPeriod still marks the current orbit", async () => {
    const fixture = fixtureWithoutVesselState(["vessel.orbit"]);
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
    const fixture = fixtureWithoutVesselState(["vessel.flight"]);
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
    const fixture = fixtureWithoutVesselState(["vessel.propulsion"]);
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
    const fixture = fixtureWithoutVesselState(["vessel.propulsion"]);
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

describe("no production series is addressed on vessel.state", () => {
  // jsdom gives this file an http URL, not a path, so git finds the root.
  const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();

  /** Files matching a POSIX extended regex; git grep's exit 1 is "no match". */
  function filesMatching(pattern: string, pathspecs: string[]): string[] {
    try {
      return execFileSync(
        "git",
        ["grep", "--untracked", "-l", "-E", pattern, "--", ...pathspecs],
        { cwd: repo, encoding: "utf8" },
      )
        .split("\n")
        .filter((line) => line !== "");
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 1)
        return [];
      throw error;
    }
  }

  const SERIES_ON_VESSEL_STATE =
    '(key|keyHigh|xKey):[[:space:]]*"vessel\\.state\\.|useDataSeries\\([^)]*"vessel\\.state\\.';

  it("finds none in any widget, app or Uplink source", () => {
    expect(
      filesMatching(SERIES_ON_VESSEL_STATE, [
        "packages/*.ts",
        "packages/*.tsx",
        "mod/*.ts",
        "mod/*.tsx",
        ":!*.test.ts",
        ":!*.test.tsx",
        ":!packages/components/scripts/*",
        ":!*/dist/*",
      ]),
    ).toEqual([]);
  });

  it("can see one, so an empty answer is not a blind search", () => {
    /* The render harness seeds the series store by literal key and never reads
       the channel, so its addresses are allowed; they are also the proof that
       this pattern matches the shape it is looking for. */
    expect(
      filesMatching(SERIES_ON_VESSEL_STATE, ["packages/components/scripts/*"]),
    ).toContain("packages/components/scripts/widgets.ts");
  });
});
