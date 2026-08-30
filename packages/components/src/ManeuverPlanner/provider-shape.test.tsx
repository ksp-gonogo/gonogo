import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import type { PropagationHorizonLike } from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANALYTIC_UNBOUNDED_HORIZON,
  integratedHorizon,
  UNBOUNDED_HORIZON,
} from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

/**
 * Both of this widget's drawings put the vessel's CURRENT orbit on screen as a
 * conic, and neither asked whether a conic was the right renderer.
 *
 * The two overlays around it are different questions and are not gated here.
 * The Conformance plot's planned conic comes off the wire as the burn's own
 * `patches[0]`: the planner's own statement, not this client's extrapolation.
 * The Preview's projected ellipses are computed client-side from the live
 * elements, which is its own contract gap, and gating them individually would
 * be the wrong repair.
 *
 * What IS in question is whether either diagram appears at all while the
 * propagation seam refuses the current orbit. A plot whose whole content is a
 * comparison against where the vessel is cannot draw one half of it and stay
 * honest: a lone planned conic with no vessel curve beside it reads as being on
 * plan.
 */
afterEach(() => {
  clearActionHandlers();
});

const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
  "vessel.maneuver",
];

const PINNED_UT = 1_000_000;

/** The captured post-burn conic from `kerbin-finite-burn-window`. */
const POST_BURN_PATCH = {
  sma: 361169.27946205,
  ecc: 0.803788750928158,
  inc: 7.48656558210146,
  lan: 18.1447306307575,
  argPe: 185.792710062224,
  meanAnomalyAtEpoch: 3.14362968912802,
  epoch: 1_000_120,
  period: 725.705339368524,
  startUt: 1_000_120,
  endUt: 1_000_845,
  patchStartTransition: 4,
  patchEndTransition: 1,
  peA: -529134.524550374,
  apA: 51473.0834744739,
  semiLatusRectum: 127826.347445211,
  semiMinorAxis: 214864.957131339,
  referenceBody: "Kerbin",
  mu: 3.5316e12,
  referenceBodyIndex: 1,
};

function mountPlanner(horizon: PropagationHorizonLike, instanceId: string) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: PINNED_UT,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <ManeuverPlannerComponent id={instanceId} config={{}} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma: 700000,
      ecc: 0.01,
      inc: 0,
      lan: 0,
      argPe: 0,
      mu: 3.5316e12,
      meanAnomalyAtEpoch: 0,
      epoch: PINNED_UT,
      horizon,
      patches: [],
    });
    fixture.emit("vessel.identity", {
      vesselId: "v1",
      name: "Test Vessel",
      vesselType: 0,
      situation: 1,
      parentBodyIndex: 1,
      launchUt: 0,
    });
    fixture.emit("system.bodies", {
      bodies: [{ index: 1, name: "Kerbin", parentIndex: 0, radius: 600000 }],
    });
    fixture.emit("vessel.maneuver", {
      planner: "stock-patched-conic",
      nodes: [
        {
          id: "3aabdda0-9d2a-4931-8511-d9bfa4be4b4e",
          ut: 1_000_120,
          dvRadial: 0,
          dvNormal: 0,
          dvPrograde: 300,
          dvTotal: 300,
          ignitionUt: 1_000_098,
          cutoffUt: 1_000_143,
          patches: [POST_BURN_PATCH],
        },
      ],
    });
  });
  return view;
}

async function openConformance(
  horizon: PropagationHorizonLike,
  instanceId: string,
) {
  const view = mountPlanner(horizon, instanceId);
  await userEvent.click(
    await screen.findByRole("tab", { name: "Conformance" }),
  );
  await waitFor(() => {
    if (view.container.querySelector("[data-conformance-plot]") === null) {
      throw new Error("the plot has not rendered yet");
    }
  });
  return view;
}

function plot(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-conformance-plot]");
  if (el === null) throw new Error("no conformance plot");
  return el;
}

describe("ManeuverPlanner's conformance plot draws the shape the provider states", () => {
  it("draws the current orbit as a conic when the provider says its trajectories are analytic", async () => {
    const { container } = await openConformance(
      ANALYTIC_UNBOUNDED_HORIZON,
      "mnv-shape-analytic",
    );
    // Two conics: the current orbit solid, the planned one dashed.
    expect(plot(container).querySelectorAll("svg ellipse").length).toBe(2);
  });

  it("draws the vouched-for arc, not a closed conic, when the provider integrates", async () => {
    const { container } = await openConformance(
      integratedHorizon(PINNED_UT + 500),
      "mnv-shape-integrated",
    );
    const path = plot(container).querySelector("svg path[data-trajectory]");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("d") ?? "").not.toMatch(/z/i);
    // The planned conic survives: it came off the wire from the planner, and
    // the seam was never asked about it.
    expect(
      plot(container).querySelectorAll("svg [stroke-dasharray]").length,
    ).toBeGreaterThan(0);
  });

  it("draws neither conic, and says why, when the producer states reach but not shape", async () => {
    const { container } = await openConformance(
      UNBOUNDED_HORIZON,
      "mnv-shape-unstated",
    );
    // A comparison with one half missing reads as a match. The plot goes, and
    // the refusal takes its place.
    expect(visibleText(container)).toContain("SHAPE NOT STATED");
    expect(plot(container).querySelectorAll("svg ellipse").length).toBe(0);
    expect(
      plot(container).querySelector("svg path[data-trajectory]"),
    ).toBeNull();
  });

  it("keeps the regime chip and the residual caption when the curves are refused", async () => {
    // Those are about the BURN: how much delta-v was asked for and how much the
    // impulsive model leaves out. Neither is a claim about the trajectory.
    const { container } = await openConformance(
      UNBOUNDED_HORIZON,
      "mnv-shape-chip",
    );
    const text = visibleText(container);
    expect(text).toMatch(/Planned|Burning|Flown|Missed|Not observed/);
    expect(text).toMatch(/impulsive plan/);
  });
});

describe("ManeuverPlanner's preview diagram draws the shape the provider states", () => {
  it("draws the current orbit as a conic when the provider says its trajectories are analytic", async () => {
    const { container } = mountPlanner(
      ANALYTIC_UNBOUNDED_HORIZON,
      "mnv-preview-analytic",
    );
    await waitFor(() => {
      if (container.querySelector("svg ellipse") === null) {
        throw new Error("the preview diagram has not rendered yet");
      }
    });
  });

  it("draws no conic, and says why, when the producer states reach but not shape", async () => {
    const { container } = mountPlanner(
      UNBOUNDED_HORIZON,
      "mnv-preview-unstated",
    );
    await waitFor(() => {
      if (!visibleText(container).includes("SHAPE NOT STATED")) {
        throw new Error("the refusal has not rendered yet");
      }
    });
    // The projected ellipses go with it: they are patched-conic extrapolations
    // of the very elements the provider declined to authorise a curve through.
    expect(container.querySelectorAll("svg ellipse").length).toBe(0);
  });

  /**
   * The post-burn figures are computed here from the live osculating elements
   * by a two-body solver, whatever the provider said the trajectory is. When
   * the provider integrates, those elements are exact at the sample instant
   * and drift from there, so "New Ap" is where the craft would go if nothing
   * else pulled on it, which is the one assumption an integrating provider
   * exists to deny.
   *
   * Measured before this was written: the whole panel's visible text was
   * character-identical between {@link ANALYTIC_UNBOUNDED_HORIZON} and
   * {@link integratedHorizon}, down to "New T 33min 7s", a PERIOD for a craft
   * whose provider will not vouch for a full revolution. The drawing differed
   * (an open arc rather than a closed ellipse) and not one number did.
   *
   * Asserted in BOTH directions on purpose. A test that only checked the note
   * appears would still pass if the note were rendered unconditionally, which
   * would put a two-body warning on every stock dashboard and teach the
   * operator to ignore it.
   */
  it("says the post-burn figures are two-body when the provider integrates", async () => {
    const { container } = mountPlanner(
      integratedHorizon(PINNED_UT + 500),
      "mnv-preview-integrated",
    );
    await waitFor(() => {
      if (container.querySelector("svg path[data-trajectory]") === null) {
        throw new Error("the arc has not rendered yet");
      }
    });
    expect(visibleText(container)).toMatch(/two-body/i);
    await act(async () => {});
  });

  it("says nothing of the sort when the provider's own trajectories are conics", async () => {
    const { container } = mountPlanner(
      ANALYTIC_UNBOUNDED_HORIZON,
      "mnv-preview-analytic-quiet",
    );
    await waitFor(() => {
      if (container.querySelector("svg ellipse") === null) {
        throw new Error("the preview diagram has not rendered yet");
      }
    });
    // Under a two-body provider the projection and the trajectory rest on the
    // same model, so there is no disagreement to declare.
    expect(visibleText(container)).not.toMatch(/two-body/i);
    await act(async () => {});
  });
});
