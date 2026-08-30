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
 * O3 is OrbitView-only, since CurrentOrbit's apsis radii already came off
 * `useOrbitElements`/`vessel.state`, never a client-side `sma·(1±ecc)`
 * computation).
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
const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

const KERBIN_MU = 3.5316e12;

describe("CurrentOrbit: O2: hyperbolic orbit still counts as hasOrbit", () => {
  it("renders the mini diagram (not suppressed) for a fully hyperbolic orbit", async () => {
    registerStockBodies();
    const stream = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
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

describe("CurrentOrbit: O4: 'measured' basis suppresses the diagram, not the grid", () => {
  it("shows the grid with NULL_DISPLAY apsides and no diagram in the measured basis", async () => {
    registerStockBodies();
    const stream = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: 0,
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
          epoch: 0,
          mu: KERBIN_MU,
          horizon: ANALYTIC_UNBOUNDED_HORIZON,
        },
        { quality: Quality.Loaded },
      );
      // The "measured" basis branch of `deriveVesselState` needs a whole
      // `vessel.flight` point to resolve at all.
      stream.emit("vessel.flight", {
        latitude: 0,
        longitude: 0,
        altitudeAsl: 70000,
        altitudeTerrain: 70000,
        verticalSpeed: 0,
        surfaceSpeed: 2200,
        orbitalSpeed: 2200,
        gForce: 0,
        dynamicPressureKPa: 0,
        mach: 0,
        atmDensity: 0,
      });
      stream.emit("vessel.identity", {
        vesselId: "v1",
        name: "Packed Ship",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 1,
        launchUt: 0,
      });
      stream.emit("system.bodies", {
        bodies: [{ index: 1, name: "Kerbin", parentIndex: 0, radius: 600000 }],
      });
    });

    // The raw eccentricity readout (a `vessel.orbit` element, not derived)
    // confirms the orbit landed, even though the derived apsides are null.
    await waitFor(() => expect(getEccentricityCell(container)).toBe("0.0051"));

    expect(container.querySelector("svg")).toBeNull();
    // Ap/Pe are gated on `hasOrbit`, which is false here (periapsisR null in
    // the measured basis): they render as NULL_DISPLAY, never a stale/garbage value.
    expect(getValueCell(container, "Ap")).toBe(NULL_DISPLAY);
    expect(getValueCell(container, "Pe")).toBe(NULL_DISPLAY);
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
