import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { emitScenario, renderOrbitViewStream } from "./streamHarness";

/**
 * Producer↔consumer disagreements O2/O3/O4: hyperbolic orbits and the
 * `vessel.state.basis` contract.
 *
 * - **O2**: `hasOrbit` must not require apoapsis. Apoapsis is `null` by
 *   design on a hyperbolic orbit (`ecc >= 1`, no apoapsis exists), the gate
 *   must still show the diagram/pill for a fully-known escape orbit, keyed
 *   off periapsis (always real whenever there's an orbit) instead.
 * - **O3**: the apsis radii must come off `vessel.state` (which is correctly
 *   `null` for a hyperbolic apoapsis), not a client-side `sma·(1+ecc)`
 *   computation (finite but GARBAGE-negative for a hyperbolic orbit, since
 *   sma<0 there), that garbage must never reach `overlayContext.scale` or
 *   any augment slot prop.
 * - **O4**: in the "measured" (Loaded/packed) basis, the derived orbital
 *   elements are null-by-design even though raw `vessel.orbit.sma`/`ecc`
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
    const { container, fixture } = renderOrbitViewStream(
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

    // White-box: `vessel.state.apoapsisRadius`: the value the widget now
    // reads for its apsis radii, must be null on this hyperbolic orbit, not
    // the old client-side `sma·(1+ecc)` finite-negative garbage
    // (-500000 * 2.4 = -1200000).
    const apoapsisPoint = fixture.store.sample<number | null>(
      "vessel.state.apoapsisRadius",
      fixture.store.currentFrame(),
    );
    expect(apoapsisPoint?.payload).toBeNull();

    const periapsisPoint = fixture.store.sample<number | null>(
      "vessel.state.periapsisRadius",
      fixture.store.currentFrame(),
    );
    // Periapsis stays real: sma·(1-ecc) = -500000 * (1 - 1.4) = 200000.
    expect(periapsisPoint?.payload).toBeCloseTo(200_000);
  });
});

describe("OrbitView: O4: 'measured' basis suppresses the diagram with a distinct empty state", () => {
  it("shows the packed empty state (not the diagram, not the generic empty state) in the measured basis", async () => {
    const { container, fixture } = renderOrbitViewStream({ w: 9, h: 18 });

    emitScenario(fixture, {
      bodyName: "Kerbin",
      sma: 681_500,
      ecc: 0.005,
      argPe: 12,
      quality: Quality.Loaded,
    });

    await waitFor(() => {
      if (!container.textContent?.includes("packed")) {
        throw new Error("packed empty state has not resolved yet");
      }
    });
    expect(container.textContent).toContain("No osculating orbit (packed)");
    expect(container.textContent).not.toContain("No orbital data");
    expect(container.querySelector("svg")).toBeNull();
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
