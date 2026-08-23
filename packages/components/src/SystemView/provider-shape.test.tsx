import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import type { PropagationHorizonLike } from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  ANALYTIC_UNBOUNDED_HORIZON,
  integratedHorizon,
  UNBOUNDED_HORIZON,
} from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/**
 * SystemView had TWO independent conic implementations of the vessel's
 * trajectory: the ellipse `VesselOrbitPath` draws from `sma`/`ecc`, and the
 * `OrbitPatch` the widget fabricates from the same elements for the predicted
 * arc. Neither asked whether a conic was the right renderer. The patch chain
 * was gated on REACH, through the derived scalars it depends on, and on shape
 * not at all, so an integrating provider still got a closed ellipse plus a
 * confident one-period prediction through it.
 *
 * The bodies around it are a separate matter and are deliberately not gated
 * here: `system.bodies` carries no `PropagationHorizon` at all, so there is
 * nothing to ask, and refusing to draw the Mun because the VESSEL's provider
 * integrates would be inventing a refusal nobody stated.
 */

const CONTRIBUTIONS_META = {
  componentId: "system-view",
  contributionSlots: ["system-view.vessel-status"] as const,
};

function WithContributions({ children }: { children: ReactNode }) {
  return (
    <WidgetMetaContext.Provider value={CONTRIBUTIONS_META}>
      <ContributionsProvider>{children}</ContributionsProvider>
    </WidgetMetaContext.Provider>
  );
}

const KERBIN_MU = 3.5316e12;
const PINNED_UT = 100;

/** A Kerbin parking orbit, elliptical so the sampled arc is not a circle. */
function orbitWith(horizon: PropagationHorizonLike) {
  return {
    referenceBodyIndex: 0,
    sma: 8_000_000,
    ecc: 0.4,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: PINNED_UT,
    mu: KERBIN_MU,
    horizon,
  };
}

function kerbinSystem() {
  return {
    bodies: [
      {
        index: 0,
        name: "Kerbin",
        parentIndex: null,
        radius: 600_000,
        gravParameter: KERBIN_MU,
        sphereOfInfluence: 84_159_286,
        rotationPeriod: 21_549.425,
        orbit: null,
      },
      {
        index: 1,
        name: "Mun",
        parentIndex: 0,
        radius: 200_000,
        gravParameter: 6.5138398e10,
        orbit: {
          sma: 12_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: PINNED_UT,
        },
      },
    ],
  };
}

/** The vessel's own accent dot, which is a POSITION and not a trajectory. */
const VESSEL_DOT = 'circle[fill="var(--color-accent-fg)"]';

async function mount(horizon: PropagationHorizonLike) {
  const fixture = setupStreamFixture({
    carriedChannels: [
      "vessel.orbit",
      "vessel.identity",
      "vessel.target",
      "system.bodies",
      "fleet.",
      "silence.",
    ],
    pinnedUt: PINNED_UT,
  });
  const { container } = render(
    <fixture.Provider>
      <WithContributions>
        <SystemViewComponent config={{}} id="sv-shape" w={14} h={14} />
      </WithContributions>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", kerbinSystem());
    fixture.emit("vessel.identity", {
      vesselId: "v",
      name: "Tester",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: 0,
    });
    fixture.emit("vessel.orbit", orbitWith(horizon));
  });
  await screen.findAllByText(/Kerbin/i);
  return container;
}

/** The vessel's own orbit curve, whichever form it took. */
function vesselCurves(container: HTMLElement): number {
  return container.querySelectorAll("[data-vessel-trajectory]").length;
}

describe("SystemView draws the vessel trajectory the provider states", () => {
  it("draws a conic when the provider says its trajectories are analytic", async () => {
    const container = await mount(ANALYTIC_UNBOUNDED_HORIZON);
    await waitFor(() => {
      if (vesselCurves(container) === 0) {
        throw new Error("the vessel curve has not rendered yet");
      }
    });
    // A closed path rather than an `<ellipse>`: the conic ARM is unchanged (the
    // elements are still the curve), and the diagram draws it by sampling and
    // placing the ring like any other, since a projected inclined orbit has a
    // centre `cx`/`cy` cannot express.
    const conic = container.querySelector(
      'path[data-vessel-trajectory="conic"]',
    );
    expect(conic).not.toBeNull();
    expect(conic?.getAttribute("d") ?? "").toMatch(/Z$/);
  });

  it("draws the vouched-for arc, not a conic, when the provider integrates", async () => {
    const container = await mount(integratedHorizon(PINNED_UT + 4000));
    await waitFor(() => {
      if (vesselCurves(container) === 0) {
        throw new Error("the vessel curve has not rendered yet");
      }
    });
    const arc = container.querySelector('path[data-vessel-trajectory="arc"]');
    expect(arc).not.toBeNull();
    // Open by construction: it stops where the provider stopped.
    expect(arc?.getAttribute("d") ?? "").not.toMatch(/z/i);
    expect(
      container.querySelector('[data-vessel-trajectory="conic"]'),
    ).toBeNull();
  });

  it("draws no vessel curve, and says why, when the producer states reach but not shape", async () => {
    const container = await mount(UNBOUNDED_HORIZON);
    await waitFor(() => {
      if (!visibleText(container).includes("SHAPE NOT STATED")) {
        throw new Error("the refusal has not rendered yet");
      }
    });
    expect(vesselCurves(container)).toBe(0);
  });

  it("keeps drawing the bodies when the vessel's trajectory is refused", async () => {
    // The bodies come off `system.bodies`, which carries no horizon at all.
    // Refusing to draw the Mun because the vessel's provider integrates would
    // be inventing a refusal nobody stated.
    const container = await mount(UNBOUNDED_HORIZON);
    await waitFor(() => {
      if (!visibleText(container).includes("SHAPE NOT STATED")) {
        throw new Error("the refusal has not rendered yet");
      }
    });
    expect(
      container.querySelectorAll("path[data-body-orbit]").length,
    ).toBeGreaterThan(0);
  });

  it("keeps the vessel marker when its trajectory is refused", async () => {
    // Where the craft IS comes from the osculating elements at the sample
    // instant and is true whoever computed them. Only the CURVE is in question.
    const container = await mount(UNBOUNDED_HORIZON);
    await waitFor(() => {
      if (container.querySelectorAll(VESSEL_DOT).length === 0) {
        throw new Error("the vessel marker has not rendered yet");
      }
    });
  });

  it("draws no vessel curve once the view instant runs past the integrator's horizon", async () => {
    const container = await mount(integratedHorizon(PINNED_UT - 50));
    await waitFor(() => {
      if (!visibleText(container).includes("BEYOND INTEGRATION")) {
        throw new Error("the refusal has not rendered yet");
      }
    });
    expect(vesselCurves(container)).toBe(0);
  });
});
