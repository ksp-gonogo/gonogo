import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { DescentEnvelope, projectDescent } from "./DescentEnvelope";

/**
 * The predicted trace, which is the plot's whole new sentence: where the
 * descent is GOING, not only where it is and where equilibrium is.
 *
 * Its physics is tested directly rather than read back out of path data,
 * because the shape of the curve is the claim and an SVG attribute is only its
 * shadow. Its own file rather than appended to `DescentEnvelope.test.tsx`,
 * which is already about the dot, the haze and the drag chevron.
 */

/** Kerbin's surface gravity, the only body constant any of this needs. */
const KERBIN_G = 9.81;

/** A terminal-velocity model that does not vary with height, which isolates the
 *  relaxation from the shape of the curve it relaxes onto. */
const flat = (vt: number) => () => vt;

describe("projectDescent", () => {
  it("slows a vessel that is faster than terminal, toward terminal", () => {
    const p = projectDescent({
      startSpeed: 900,
      startAltitude: 20_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(120),
    });
    expect(p.points[0].speed).toBeCloseTo(900, 5);
    expect(p.touchdownSpeed).toBeCloseTo(120, 0);
    // Monotonic: a descent above terminal never speeds up on the way down.
    for (let i = 1; i < p.points.length; i++) {
      expect(p.points[i].speed).toBeLessThanOrEqual(p.points[i - 1].speed);
    }
  });

  it("speeds up a vessel that is slower than terminal, toward terminal", () => {
    const p = projectDescent({
      startSpeed: 20,
      startAltitude: 20_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(120),
    });
    expect(p.touchdownSpeed).toBeGreaterThan(20);
    expect(p.touchdownSpeed).toBeCloseTo(120, 0);
  });

  it("stays finite and positive from an enormous excess over terminal", () => {
    // The reason the step is the equation's exact solution rather than a
    // forward difference: an entry starts tens of times terminal velocity, and
    // a forward step there overshoots through zero into a negative speed.
    const p = projectDescent({
      startSpeed: 7800,
      startAltitude: 60_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(90),
    });
    for (const point of p.points) {
      expect(Number.isFinite(point.speed)).toBe(true);
      expect(point.speed).toBeGreaterThan(0);
    }
    expect(p.touchdownSpeed).toBeCloseTo(90, 0);
  });

  it("reports the height it settles onto the curve at", () => {
    const p = projectDescent({
      startSpeed: 900,
      startAltitude: 20_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(120),
    });
    expect(p.settleAltitude).not.toBeNull();
    expect(p.settleAltitude as number).toBeGreaterThan(0);
    expect(p.settleAltitude as number).toBeLessThan(20_000);
  });

  it("reports NO settle height for a vessel already riding the curve", () => {
    // It did not settle on the way down, it started settled, and a tick at the
    // vessel's own altitude would point at the mark beside it.
    const p = projectDescent({
      startSpeed: 121,
      startAltitude: 20_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(120),
    });
    expect(p.settleAltitude).toBeNull();
  });

  it("settles DEEPER the higher the terminal velocity is", () => {
    // The plot's whole entry read: a high ballistic coefficient means a high
    // terminal velocity, which drives the deceleration further down.
    const shallow = projectDescent({
      startSpeed: 1400,
      startAltitude: 20_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(90),
    });
    const deep = projectDescent({
      startSpeed: 1400,
      startAltitude: 20_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(200),
    });
    expect(deep.settleAltitude as number).toBeLessThan(
      shallow.settleAltitude as number,
    );
  });
});

describe("DescentEnvelope predicted trace", () => {
  const entry = {
    currentSpeed: 2200,
    currentAltitude: 28_000,
    terminalVelocity: 300,
    projectedTouchdownSpeed: 95,
  };

  function marks(container: HTMLElement, mark: string) {
    return Array.from(
      container.querySelectorAll(`[data-envelope-mark="${mark}"]`),
    );
  }

  it("draws NO trace without the body's surface gravity", () => {
    // The one input the integration cannot do without. An absent body renders
    // as an absent trace, never as a trace against a guessed one.
    const { container } = render(<DescentEnvelope {...entry} />);
    expect(marks(container, "trace-estimate")).toHaveLength(0);
    expect(marks(container, "trace-settled")).toHaveLength(0);
    expect(marks(container, "settle-tick")).toHaveLength(0);
  });

  it("draws NO trace without a current speed to leave from", () => {
    const { container } = render(
      <DescentEnvelope
        {...entry}
        currentSpeed={null}
        surfaceGravity={KERBIN_G}
      />,
    );
    expect(marks(container, "trace-estimate")).toHaveLength(0);
  });

  it("runs the trace from the vessel down to the ground edge", () => {
    const { container } = render(
      <DescentEnvelope {...entry} surfaceGravity={KERBIN_G} />,
    );
    const points = marks(container, "trace-estimate")
      .concat(marks(container, "trace-settled"))
      .flatMap((el) =>
        (el.getAttribute("points") ?? "")
          .trim()
          .split(/\s+/)
          .map((p) => p.split(",").map(Number)),
      );
    expect(points.length).toBeGreaterThan(10);
    // The bottom edge IS the ground, so the projection has to reach it.
    expect(Math.max(...points.map(([, y]) => y))).toBeCloseTo(160, 0);
  });

  it("dashes the part of the trace still to cross the transonic region", () => {
    const supersonic = render(
      <DescentEnvelope {...entry} surfaceGravity={KERBIN_G} mach={7} />,
    );
    const subsonic = render(
      <DescentEnvelope
        currentSpeed={105}
        currentAltitude={900}
        terminalVelocity={88}
        projectedTouchdownSpeed={84}
        surfaceGravity={KERBIN_G}
        mach={0.31}
      />,
    );
    expect(
      marks(supersonic.container, "trace-estimate")[0].getAttribute(
        "stroke-dasharray",
      ),
    ).not.toBeNull();
    expect(
      marks(subsonic.container, "trace-estimate")[0].getAttribute(
        "stroke-dasharray",
      ),
    ).toBeNull();
  });

  it("marks and names the height the descent settles at", () => {
    const { container } = render(
      <DescentEnvelope {...entry} surfaceGravity={KERBIN_G} />,
    );
    expect(marks(container, "settle-tick")).toHaveLength(1);
    const words = Array.from(container.querySelectorAll("svg > text")).map(
      (t) => t.textContent ?? "",
    );
    expect(words.some((w) => w.startsWith("SETTLES"))).toBe(true);
    // And in the accessible label, so the shape is never the only channel.
    expect(
      container.querySelector("svg")?.getAttribute("aria-label"),
    ).toContain("settles onto the terminal curve");
  });

  it("says so in the label when the descent never settles before the ground", () => {
    // A vessel that arrives still slowing is the reading the plot exists for,
    // and an absent tick must not be the only way to learn it.
    const { container } = render(
      <DescentEnvelope
        currentSpeed={2200}
        currentAltitude={900}
        terminalVelocity={1800}
        projectedTouchdownSpeed={900}
        surfaceGravity={KERBIN_G}
      />,
    );
    expect(marks(container, "settle-tick")).toHaveLength(0);
    expect(
      container.querySelector("svg")?.getAttribute("aria-label"),
    ).toContain("never settles onto the terminal curve");
  });

  it("shades the decelerating half-plane without crossing itself", () => {
    const { container } = render(
      <DescentEnvelope {...entry} surfaceGravity={KERBIN_G} />,
    );
    const wash = container.querySelector(
      '[data-envelope-region="decelerating"]',
    );
    expect(wash).not.toBeNull();
    const pts = (wash?.getAttribute("points") ?? "")
      .trim()
      .split(/\s+/)
      .map((p) => p.split(",").map(Number));
    // The return leg comes back down the RIGHT edge, top corner before bottom.
    // The other order draws a bow tie, two filled triangles that mean nothing,
    // which is what this shape did first time out.
    expect(pts[pts.length - 2]).toEqual([160, 0]);
    expect(pts[pts.length - 1]).toEqual([160, 160]);
  });
});
