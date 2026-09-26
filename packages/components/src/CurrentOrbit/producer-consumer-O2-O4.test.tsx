import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

/**
 * Producer↔consumer disagreements O2/O4: the CurrentOrbit half (see
 * `OrbitView/producer-consumer-O2-O3-O4.test.tsx` for the fuller writeup;
 * O3 is OrbitView-only, since CurrentOrbit's apsis radii come off the orbit
 * solve, never a client-side `sma·(1±ecc)` computation).
 *
 * - **O2**: `hasOrbit` must not require apoapsis (`null`-by-design on a
 *   hyperbolic orbit). This was already true by accident here (`null !==
 *   undefined` in the old gate), so this test is a REGRESSION PIN, not a
 *   before/after fix: it guards against a future `apoapsisRadius ??
 *   undefined` refactor silently flipping the gate.
 * - **O4**: in the "measured" basis the mini diagram must be suppressed
 *   (already true via O2's gate: `periapisR` is `null` there too), but the
 *   numeric grid must still render (raw `ecc` + NULL_DISPLAY for the null derived
 *   apsides) rather than some other empty state.
 */
const CURRENT_ORBIT_CHANNELS = [
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
];

const KERBIN_MU = 3.5316e12;

describe("CurrentOrbit: O2: hyperbolic orbit still counts as hasOrbit", () => {
  it("renders the mini diagram (not suppressed) for a fully hyperbolic orbit", async () => {
    registerStockBodies();
    const stream = setupStreamFixture({
      carriedChannels: CURRENT_ORBIT_CHANNELS,
      pinnedUt: 0,
      suspendFrames: true,
    });

    const { container } = render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-o2" }}>
          <CurrentOrbitComponent config={{}} id="orbit-o2" w={9} h={18} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );

    act(() => {
      stream.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: -500_000,
          ecc: 1.4,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 0,
          mu: KERBIN_MU,
          horizon: ANALYTIC_UNBOUNDED_HORIZON,
        },
        { quality: Quality.OnRails },
      );
      stream.emit("vessel.identity", {
        vesselId: "v1",
        name: "Escape Pod",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 1,
        launchUt: 0,
      });
      stream.emit("system.bodies", {
        bodies: [{ index: 1, name: "Kerbin", parentIndex: 0, radius: 600000 }],
      });
    });

    await waitFor(() => expect(getEccentricityCell(container)).toBe("1.4000"));
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

/**
 * A loaded craft at 1x: the mod stamps `Quality.Loaded`, so the conic declines
 * to advance the elements. The apsides and the diagram come from the elements
 * as they stand, and the countdowns from KSP's own, sent on the sample and run
 * down by the view time since it was taken.
 */
describe("CurrentOrbit: O4: a craft under physics keeps every figure", () => {
  async function renderLoaded(
    countdowns: { timeToAp?: number; timeToPe?: number },
    sampleUt: number,
    viewUt: number,
  ) {
    registerStockBodies();
    const stream = setupStreamFixture({
      carriedChannels: CURRENT_ORBIT_CHANNELS,
      pinnedUt: viewUt,
      suspendFrames: true,
    });
    const { container } = render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-o4" }}>
          <CurrentOrbitComponent config={{}} id="orbit-o4" w={9} h={18} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );

    act(() => {
      stream.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: 681_500,
          ecc: 0.005135,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: sampleUt,
          mu: KERBIN_MU,
          horizon: ANALYTIC_UNBOUNDED_HORIZON,
          ...countdowns,
        },
        { quality: Quality.Loaded, validAt: sampleUt },
      );
      stream.emit("vessel.identity", {
        vesselId: "v1",
        name: "Loaded Ship",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 1,
        launchUt: 0,
      });
      stream.emit("system.bodies", {
        bodies: [{ index: 1, name: "Kerbin", parentIndex: 0, radius: 600000 }],
      });
    });

    await waitFor(() => expect(getEccentricityCell(container)).toBe("0.0051"));
    return container;
  }

  it("draws a loaded craft's apsides and diagram off the elements as they stand", async () => {
    const container = await renderLoaded({}, 0, 0);

    // sma(1 ± ecc) less Kerbin's 600 km, off the elements as they stand.
    await waitFor(() =>
      expect(getValueCell(container, "Ap")).toMatch(/^85\.0/),
    );
    expect(getValueCell(container, "Pe")).toMatch(/^78\.0/);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("shows KSP's time to apoapsis and periapsis at 1x", async () => {
    const container = await renderLoaded(
      { timeToAp: 900, timeToPe: 1800 },
      0,
      0,
    );

    await waitFor(() => expect(getValueCell(container, "t-Ap")).toBe("15min"));
    expect(getValueCell(container, "t-Pe")).toBe("30min");
  });

  it("runs them down by the view time elapsed since the sample", async () => {
    // Sampled at UT 40, viewed at UT 100: both apsides are a minute nearer.
    const container = await renderLoaded(
      { timeToAp: 900, timeToPe: 1800 },
      40,
      100,
    );

    await waitFor(() => expect(getValueCell(container, "t-Ap")).toBe("14min"));
    expect(getValueCell(container, "t-Pe")).toBe("29min");
  });

  it("dashes the countdowns of a sample that carries none", async () => {
    const container = await renderLoaded({}, 0, 0);

    await waitFor(() =>
      expect(getValueCell(container, "Ap")).toMatch(/^85\.0/),
    );
    expect(getValueCell(container, "t-Ap")).toBe(NULL_DISPLAY);
    expect(getValueCell(container, "t-Pe")).toBe(NULL_DISPLAY);
  });
});

function getEccentricityCell(container: HTMLElement): string | undefined {
  return getValueCell(container, "Ecc");
}

function getValueCell(
  container: HTMLElement,
  label: string,
): string | undefined {
  const labelEl = Array.from(container.querySelectorAll("span")).find(
    (el) => el.textContent === label,
  );
  return labelEl?.nextElementSibling?.textContent ?? undefined;
}
