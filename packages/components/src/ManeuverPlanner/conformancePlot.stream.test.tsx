import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { vesselManeuverLegacyChannel } from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

/**
 * The Conformance plot's PLANNED conic comes from the burn's own
 * `patches[0]`, the planner's statement of what the burn produces. This file
 * exists because that field had no producer at all: `Sitrep.Contract
 * .ManeuverNode.Patches` was documented, encoded onto the wire, and never
 * assigned, so every node arrived with an empty chain.
 *
 * Nothing caught it because nothing read it. The legacy reshape takes a node's
 * headline PeA/ApA/sma/eccentricity/referenceBody straight from `patches[0]`
 * and defaults them to 0/"" when it is absent, and no widget rendered those,
 * so the wire carried zeros with no visible symptom. The plot is the field's
 * first reader, which means it is also the first thing that would have drawn a
 * confident empty picture from it.
 *
 * So the assertion that matters here is the NEGATIVE one: an empty chain must
 * not silently produce a plot with one line in it that reads as a match.
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

function emitOrbitReady(fixture: ReturnType<typeof setupStreamFixture>) {
  fixture.emit("vessel.orbit", {
    referenceBodyIndex: 1,
    sma: 700000,
    ecc: 0.01,
    inc: 0,
    lan: 0,
    argPe: 0,
    mu: 3.5316e12,
    meanAnomalyAtEpoch: 0,
    epoch: 1_000_000,
    // What the stock producer sends. Without it the sample is one from a
    // producer that dropped the field, the seam refuses the current orbit, and
    // the plot this file is about never draws: see `provider-shape.test.tsx`
    // for that case, which is its subject rather than a side effect.
    horizon: ANALYTIC_UNBOUNDED_HORIZON,
    patches: [],
  });
}

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

function emitNode(
  fixture: ReturnType<typeof setupStreamFixture>,
  patches: unknown[],
) {
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
        patches,
      },
    ],
  });
}

async function mountOnConformance(patches: unknown[]) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 1_000_000,
  });
  fixture.store.registerDerivedChannel(vesselManeuverLegacyChannel);

  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mnv-plot" }}>
        <ManeuverPlannerComponent id="mnv-plot" config={{}} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );

  act(() => {
    emitOrbitReady(fixture);
    emitNode(fixture, patches);
  });

  const tab = await screen.findByRole("tab", { name: "Conformance" });
  await userEvent.click(tab);
  return view;
}

/** The projected conic is the only DASHED conic the diagram draws. */
function plannedConics(container: HTMLElement): number {
  return container.querySelectorAll(
    "[data-conformance-plot] svg [stroke-dasharray]",
  ).length;
}

/**
 * `mustBeVisible` in the render harness is scoped to `[data-burn-instant-row]`,
 * and its check is "nothing matching this is clipped", which a selector matching
 * NOTHING satisfies. That attribute appeared in exactly two places, the component
 * and the harness config, with no test asserting it renders, so renaming it would
 * have left the clipping gate passing forever on every size.
 */
describe("ManeuverPlanner: the render gate's selector still matches", () => {
  it("renders burn instant rows carrying the attribute the harness gate looks for", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 1_000_000,
    });
    fixture.store.registerDerivedChannel(vesselManeuverLegacyChannel);
    const view = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-gate" }}>
          <ManeuverPlannerComponent id="mnv-gate" config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      emitOrbitReady(fixture);
      emitNode(fixture, [POST_BURN_PATCH]);
    });
    await waitFor(() => {
      expect(
        view.container.querySelectorAll("[data-burn-instant-row]").length,
      ).toBeGreaterThan(0);
    });
  });
});

describe("ManeuverPlanner: the conformance plot's planned conic", () => {
  it("draws the planned conic from the burn's own patches[0]", async () => {
    const view = await mountOnConformance([POST_BURN_PATCH]);
    await waitFor(() => {
      expect(
        view.container.querySelector("[data-conformance-plot]"),
      ).not.toBeNull();
      expect(plannedConics(view.container)).toBeGreaterThan(0);
    });
  });

  it("draws NO planned conic when the patch chain is empty", async () => {
    // The state the wire was actually in before the stock backend was wired to
    // KSP's nextPatch. The plot must not present the current orbit alone as
    // though the vessel were sitting on its planned trajectory.
    const view = await mountOnConformance([]);
    await waitFor(() => {
      expect(
        view.container.querySelector("[data-conformance-plot]"),
      ).not.toBeNull();
    });
    expect(plannedConics(view.container)).toBe(0);
  });
});
