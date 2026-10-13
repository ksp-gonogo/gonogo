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
import { type OrbitScenario, renderOrbitStream } from "../test/orbitScenario";
import { CurrentOrbitComponent } from "./index";

/**
 * The mini diagram draws the shape the provider states, never its own.
 * The numbers beside it were measured and stay whoever computed them; only the curve is gated.
 */

/** Wide enough for the diagram slot (`cols >= 5 && (rows >= 8 || cols >= 10)`). */
const SIZE = { w: 9, h: 18 };

const LKO: Omit<OrbitScenario, "horizon"> = {
  bodyName: "Kerbin",
  sma: 681500,
  ecc: 0.005,
  argPe: 0,
};

function render(scenario: OrbitScenario) {
  return renderOrbitStream(
    <CurrentOrbitComponent id="current-orbit-shape" w={SIZE.w} h={SIZE.h} />,
    scenario,
    "current-orbit-shape",
  );
}

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

async function waitForText(
  container: HTMLElement,
  needle: string,
): Promise<void> {
  await waitFor(() => {
    if (!visibleText(container).includes(needle)) {
      throw new Error(`"${needle}" has not rendered yet`);
    }
  });
}

describe("CurrentOrbit draws the shape the provider states", () => {
  it("draws a closed conic when the provider says its trajectories are analytic", async () => {
    const { container } = render({
      ...LKO,
      horizon: ANALYTIC_UNBOUNDED_HORIZON,
    });
    await waitForDiagram(container);
    expect(closedConics(container)).toBe(1);
  });

  it("draws the vouched-for arc, not a closed conic, when the provider integrates", async () => {
    const { container } = render({ ...LKO, horizon: integratedHorizon(500) });
    await waitForDiagram(container);
    // The osculating conic is exact at the sample instant and is not the path.
    expect(closedConics(container)).toBe(0);
    const path = container.querySelector("svg path[data-trajectory]");
    expect(path).not.toBeNull();
    const d = path?.getAttribute("d") ?? "";
    expect(d).not.toMatch(/z/i);
    expect(d.split("L").length).toBeGreaterThan(8);
  });

  it("draws no curve at all when the producer states reach but not shape", async () => {
    const { container } = render({ ...LKO, horizon: UNBOUNDED_HORIZON });
    // `Unspecified` is what a producer that dropped the field sends, so it must not read as conic.
    await waitForText(container, "SHAPE NOT STATED");
    expect(closedConics(container)).toBe(0);
    expect(container.querySelector("svg path[data-trajectory]")).toBeNull();
  });

  it("draws no curve once the view instant runs past the integrator's horizon", async () => {
    // The fixture pins the view clock at UT 0, so a horizon in the PAST is the operator looking at an instant the provider has not computed.
    const { container } = render({ ...LKO, horizon: integratedHorizon(-100) });
    await waitForText(container, "BEYOND INTEGRATION");
    expect(closedConics(container)).toBe(0);
  });

  it("keeps the numbers when the curve is refused", async () => {
    // A refusal is about the path; blanking the measured numbers would report an outage that has not happened.
    const { container } = render({ ...LKO, horizon: UNBOUNDED_HORIZON });
    await waitForText(container, "SHAPE NOT STATED");
    const text = visibleText(container);
    expect(text).toContain("Ap");
    expect(text).toContain("Pe");
    expect(text).toContain("0.0050");
  });

  it("announces the refusal rather than leaving the diagram slot silently empty", async () => {
    const { container } = render({ ...LKO, horizon: UNBOUNDED_HORIZON });
    await waitFor(() => {
      if (container.querySelector('[role="status"]') === null) {
        throw new Error("refusal has not rendered yet");
      }
    });
    await expectNoA11yViolations(container);
  });
});
