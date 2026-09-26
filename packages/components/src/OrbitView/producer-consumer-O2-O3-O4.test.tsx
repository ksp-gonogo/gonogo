import { useOrbitSolve } from "@ksp-gonogo/core";
import type { OrbitalSolve } from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { renderOrbitStream } from "../test/orbitScenario";
import { OrbitViewComponent } from "./index";
import { emitScenario, renderOrbitViewStream } from "./streamHarness";

/**
 * Producer↔consumer disagreements O2/O3/O4: hyperbolic orbits and the packed
 * (under physics) case.
 *
 * - **O2**: `hasOrbit` must not require apoapsis. Apoapsis is `null` by
 *   design on a hyperbolic orbit (`ecc >= 1`, no apoapsis exists), the gate
 *   must still show the diagram/pill for a fully-known escape orbit, keyed
 *   off periapsis (always real whenever there's an orbit) instead.
 * - **O3**: the apsis radii must come off the orbit solve (which is correctly
 *   `null` for a hyperbolic apoapsis), not a client-side `sma·(1+ecc)`
 *   computation (finite but GARBAGE-negative for a hyperbolic orbit, since
 *   sma<0 there), that garbage must never reach `overlayContext.scale` or
 *   any augment slot prop.
 * - **O4**: while the craft is under physics (Loaded/packed), the conic
 *   declines to advance the elements even though raw `vessel.orbit.sma`/`ecc`
 *   are present. The widget must not draw a diagram from those osculating
 *   elements, and must show a distinct "packed" empty state rather than the
 *   generic "No orbital data" (which implies no orbit at all, not true here).
 */
describe("OrbitView: O2: hyperbolic orbit still counts as hasOrbit", () => {
  it("renders the diagram (not 'No orbital data') for a fully hyperbolic orbit", async () => {
    const { container } = renderOrbitViewStream(
      { w: 9, h: 18 },
      {
        bodyName: "Kerbin",
        sma: -500_000,
        ecc: 1.4,
        argPe: 0,
        quality: Quality.OnRails,
      },
    );

    await waitFor(() => {
      if (container.querySelector("svg") === null) {
        throw new Error("diagram has not rendered yet");
      }
    });
    expect(container.textContent).not.toContain("No orbital data");
    // The periapsis marker/label renders (real on a hyperbolic orbit) but
    // the apoapsis one doesn't (there is none), confirms `hasOrbit`
    // resolved true off periapsis alone, not a fabricated apoapsis.
    expect(
      container.querySelector('[aria-label^="Periapsis altitude"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label^="Apoapsis altitude"]'),
    ).toBeNull();
  });
});

describe("OrbitView: O3: no finite-negative apoapsis leaks into the overlay scale", () => {
  it("keeps overlayContext.scale periapsis-driven (never a negative apoapsis) on a hyperbolic orbit", async () => {
    let solved: OrbitalSolve | null = null;
    function SolveProbe() {
      solved = useOrbitSolve();
      return null;
    }
    const { container } = renderOrbitStream(
      <>
        <OrbitViewComponent id="orbitview-o3" w={9} h={18} />
        <SolveProbe />
      </>,
      {
        bodyName: "Kerbin",
        sma: -500_000,
        ecc: 1.4,
        argPe: 0,
        quality: Quality.OnRails,
      },
      "orbitview-o3",
    );

    await waitFor(() => {
      if (container.querySelector("svg") === null) {
        throw new Error("diagram has not rendered yet");
      }
    });

    // White-box: the solve the widget reads its apsis radii from, in the same
    // provider. The apoapsis must be null on this hyperbolic orbit, never a
    // client-side `sma·(1+ecc)` finite-negative figure (-500000 * 2.4 =
    // -1200000).
    const solve = solved as OrbitalSolve | null;
    expect(solve).not.toBeNull();
    expect(solve?.apoapsisRadius).toBeNull();
    // Periapsis stays real: sma·(1-ecc) = -500000 * (1 - 1.4) = 200000.
    expect(solve?.periapsisRadius).toBeCloseTo(200_000);
  });
});

describe("OrbitView: O4: a craft under physics still has an orbit to draw", () => {
  it("draws a loaded craft's current orbit rather than refusing it", async () => {
    const { container, fixture } = renderOrbitViewStream({ w: 9, h: 18 });

    emitScenario(fixture, {
      bodyName: "Kerbin",
      sma: 681_500,
      ecc: 0.005,
      argPe: 12,
      quality: Quality.Loaded,
    });

    // The apsides are algebra on the elements as they stand, so being under
    // physics withholds nothing this diagram draws.
    await waitFor(() => {
      if (container.querySelector("svg") === null) {
        throw new Error("diagram has not rendered yet");
      }
    });
    expect(container.textContent).not.toContain("No osculating orbit");
    expect(container.textContent).not.toContain("No orbital data");
  });

  it("still renders the diagram for a normal orbit in the 'propagated' basis", async () => {
    const { container } = renderOrbitViewStream(
      { w: 9, h: 18 },
      { bodyName: "Kerbin", sma: 681_500, ecc: 0.005, argPe: 12 },
    );

    await waitFor(() => {
      if (container.querySelector("svg") === null) {
        throw new Error("diagram has not rendered yet");
      }
    });
    expect(container.textContent).not.toContain("No osculating orbit");
    expect(container.textContent).not.toContain("No orbital data");
  });
});
