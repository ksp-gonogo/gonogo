import { waitFor } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  ANALYTIC_UNBOUNDED_HORIZON,
  integratedHorizon,
  UNBOUNDED_HORIZON,
} from "../test/orbitHorizon";
import { type OrbitScenario, renderOrbitViewStream } from "./streamHarness";

/**
 * The widget must not decide what shape an orbit is.
 *
 * `vessel.orbit` carries a `PropagationHorizon` whose `trajectoryKind` is the
 * elected provider's own statement of what its elements describe: a closed-form
 * conic, or a snapshot of an integrated path. A widget that reads `sma`/`ecc`
 * and emits an ellipse regardless has answered that question for itself, which
 * means electing a different provider changes nothing the operator sees.
 *
 * These tests are written against the RENDERED SHAPE rather than against a
 * helper's return value on purpose. A unit test of the decision function would
 * pass whether or not the widget consulted it, so it could not express the
 * failure it is being asked about.
 */

const LKO: Omit<OrbitScenario, "horizon"> = {
  bodyName: "Kerbin",
  sma: 681500,
  ecc: 0.005,
  argPe: 0,
};

/** The SVG element a closed conic renders as: `<ellipse>` and nothing else. */
function closedConics(container: HTMLElement): number {
  return container.querySelectorAll("svg ellipse").length;
}

async function waitForDiagram(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    if (container.querySelector("svg") === null) {
      throw new Error("diagram has not rendered yet");
    }
  });
}

describe("OrbitView draws the shape the provider states", () => {
  it("draws a closed conic when the provider says its trajectories are analytic", async () => {
    const { container } = renderOrbitViewStream(
      { w: 9, h: 18 },
      { ...LKO, horizon: ANALYTIC_UNBOUNDED_HORIZON },
    );
    await waitForDiagram(container);
    expect(closedConics(container)).toBe(1);
  });

  it("draws no closed conic when the provider says its trajectories are integrated", async () => {
    const { container } = renderOrbitViewStream(
      { w: 9, h: 18 },
      { ...LKO, horizon: integratedHorizon(500) },
    );
    await waitForDiagram(container);
    // The osculating conic on the wire is exact at the sample instant and is
    // not the path. A closed ellipse drawn from it is a curve the craft will
    // not fly, and drawing one is the whole defect.
    expect(closedConics(container)).toBe(0);
  });

  it("draws the arc the integrating provider vouched for, and stops there", async () => {
    const { container } = renderOrbitViewStream(
      { w: 9, h: 18 },
      { ...LKO, horizon: integratedHorizon(500) },
    );
    await waitForDiagram(container);
    const path = container.querySelector("svg path[data-trajectory]");
    expect(path).not.toBeNull();
    // A bounded arc is an open polyline: no `Z`, and more than the two points
    // a degenerate sample would emit.
    const d = path?.getAttribute("d") ?? "";
    expect(d).not.toMatch(/z/i);
    expect(d.split("L").length).toBeGreaterThan(8);
  });

  it("draws nothing at all when the producer states reach but not shape", async () => {
    const { container } = renderOrbitViewStream(
      { w: 9, h: 18 },
      { ...LKO, horizon: UNBOUNDED_HORIZON },
    );
    // `Unspecified` is what a producer that dropped the field sends. Reading it
    // as "conic" would put the permissive default back, which is the failure
    // the enum's own zero-value ordering exists to prevent.
    await waitFor(() => {
      if (!visibleText(container).includes("SHAPE NOT STATED")) {
        throw new Error("shape-refusal has not rendered yet");
      }
    });
    expect(closedConics(container)).toBe(0);
    expect(container.querySelector("svg path[data-trajectory]")).toBeNull();
  });

  it("draws nothing once the view instant runs past the integrator's horizon", async () => {
    // The harness pins the view clock at UT 0, so a horizon in the PAST is the
    // operator looking at an instant the provider has not computed.
    const { container } = renderOrbitViewStream(
      { w: 9, h: 18 },
      { ...LKO, horizon: integratedHorizon(-100) },
    );
    await waitFor(() => {
      if (!visibleText(container).includes("BEYOND INTEGRATION")) {
        throw new Error("horizon-refusal has not rendered yet");
      }
    });
    expect(closedConics(container)).toBe(0);
  });

  it("keeps the status pill in a tiny cell rather than the refusal text", async () => {
    // The pill reports the craft's state at this instant, which the osculating
    // elements carry whoever computed them. Only the PATH is in question, and a
    // 3x3 cell has no room for a two-line refusal.
    const { container } = renderOrbitViewStream(
      { w: 3, h: 3 },
      { ...LKO, horizon: integratedHorizon(500) },
    );
    await waitFor(() => {
      if (!/orbit|orbital|escape/i.test(visibleText(container))) {
        throw new Error("status pill has not resolved yet");
      }
    });
    expect(visibleText(container)).not.toContain("BEYOND INTEGRATION");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("announces a refusal rather than leaving the panel silently empty", async () => {
    const { container } = renderOrbitViewStream(
      { w: 9, h: 18 },
      { ...LKO, horizon: UNBOUNDED_HORIZON },
    );
    await waitFor(() => {
      if (container.querySelector('[role="status"]') === null) {
        throw new Error("refusal has not rendered yet");
      }
    });
    await expectNoA11yViolations(container);
  });
});
