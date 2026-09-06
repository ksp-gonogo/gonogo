import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { crossingBoundaryX, RailCrossing, waveformPath } from "./RailCrossing";
import { DEFAULT_RAIL_TAGS, type RailTags, VOICE_RAIL_TAGS } from "./railTags";

const SCIENCE_HOME: RailTags = {
  direction: "telemetry",
  continuity: "discrete",
  delivery: "fire-and-forget",
};

const FLY_BY_WIRE: RailTags = {
  direction: "command",
  continuity: "continuous",
  delivery: "acked",
};

/** Every "x.xx,y.yy" vertex of a path, in order. */
function vertices(d: string): { x: number; y: number }[] {
  return [...d.matchAll(/(-?\d+\.\d\d),(-?\d+\.\d\d)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
}

const MID_Y = 8;

describe("waveformPath", () => {
  it("puts the newest sample at this end and older ones further out", () => {
    // Newest last in, so 0.9 is `now` and lands at x=0.
    const d = waveformPath([0.1, 0.9], 1, 100);
    expect(d.startsWith("M0.00,")).toBe(true);
    expect(d).toContain("100.00,");
  });

  it("crosses the centre line, so an amplitude is a PEAK and not a pen width", () => {
    /*
     * The defect this replaces: a filled envelope, thin where the operator was
     * quiet and fat where they were loud, which reads as a growing stroke
     * rather than as a wave. A wave goes above the line and then below it.
     */
    const ys = vertices(waveformPath(new Array(64).fill(1), 63, 100)).map(
      (v) => v.y,
    );
    expect(ys.some((y) => y < MID_Y)).toBe(true);
    expect(ys.some((y) => y > MID_Y)).toBe(true);
    for (let i = 1; i < ys.length; i++) {
      expect(Math.sign(ys[i] - MID_Y)).toBe(-Math.sign(ys[i - 1] - MID_Y));
    }
  });

  it("is an open trace, not the closed outline of a filled shape", () => {
    expect(waveformPath([0.5, 0.5, 0.5], 2, 100).endsWith(" Z")).toBe(false);
  });

  it("holds one period whatever the sample density, so it always reads as a wave", () => {
    /*
     * 128 chunks of history and 50 draw the same number of vertices over the
     * same distance: the period is the DRAWING's, not the capture rate's, so a
     * dense ring does not collapse into a solid hatch.
     */
    const dense = waveformPath(new Array(129).fill(0.5), 128, 100);
    const sparse = waveformPath(new Array(51).fill(0.5), 50, 100);
    expect(vertices(dense)).toHaveLength(vertices(sparse).length);
    expect(vertices(dense).length).toBeGreaterThan(8);
  });

  it("is symmetric about the mid-line, so the peaks read either way", () => {
    const d = waveformPath(new Array(64).fill(1), 63, 100);
    expect(d).toContain(",2.50");
    expect(d).toContain(",13.50");
  });

  it("drops samples that have already arrived rather than piling them up", () => {
    // span 2 => ages 0,1,2 are still crossing; the three older ones are home,
    // so the trace reaches the boundary and stops rather than folding them in.
    const wide = vertices(waveformPath([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 2, 100));
    expect(wide[wide.length - 1].x).toBe(100);
  });

  it("draws silence as a flat line on the centre rather than as nothing at all", () => {
    const flat = vertices(waveformPath(new Array(32).fill(0), 31, 100));
    expect(flat.length).toBeGreaterThan(1);
    for (const v of flat) expect(v.y).toBe(MID_Y);
  });

  it("is empty with nothing to draw", () => {
    expect(waveformPath([], 4, 100)).toBe("");
  });

  it("survives a non-finite sample rather than emitting NaN geometry", () => {
    const d = waveformPath([Number.NaN, 0.5], 1, 100);
    expect(d).not.toContain("NaN");
  });
});

describe("the boundary is where the drawn journey ends", () => {
  it("sits halfway when there is a leg back", () => {
    expect(crossingBoundaryX(true)).toBe(50);
  });

  it("sits at the far end when nothing comes back", () => {
    expect(crossingBoundaryX(false)).toBeGreaterThan(90);
  });
});

describe("RailCrossing", () => {
  it("draws the operator's voice as a ribbon with no return leg", () => {
    const { container } = render(
      <RailCrossing
        tags={VOICE_RAIL_TAGS}
        amplitudes={[0.2, 0.6, 0.4]}
        spanSamples={3}
        label="Your transmission crossing to Odyssey"
      />,
    );
    const svg = container.querySelector("[data-rail-crossing]");
    expect(svg?.getAttribute("data-mark")).toBe("ribbon");
    expect(svg?.getAttribute("data-return-leg")).toBe("false");
    expect(container.querySelector('[data-role="ribbon"]')).not.toBeNull();
    // The lie the tagging exists to remove: nothing is drawn coming back.
    expect(container.querySelector('[data-role="dot"]')).toBeNull();
  });

  it("strokes the voice as a trace rather than filling it as a blob", () => {
    const { container } = render(
      <RailCrossing
        tags={VOICE_RAIL_TAGS}
        amplitudes={[0.2, 0.6, 0.4]}
        spanSamples={3}
        label="Your transmission crossing to Odyssey"
      />,
    );
    const trace = container.querySelector('[data-role="ribbon"]');
    expect(trace?.getAttribute("fill")).toBe("none");
    expect(trace?.getAttribute("stroke")).toMatch(/^url\(#/);
    /*
     * The box is stretched to the widget's width (preserveAspectRatio="none"),
     * so a scaled stroke would come out several times thicker across than it is
     * tall: the pen the operator already objected to, back by another route.
     */
    expect(trace?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });

  it("puts the boundary at the far end for a fire-and-forget entry", () => {
    const { container } = render(
      <RailCrossing
        tags={VOICE_RAIL_TAGS}
        amplitudes={[0.5]}
        label="Transmission"
      />,
    );
    const boundary = container.querySelector('[data-role="boundary"]');
    expect(Number(boundary?.getAttribute("x1"))).toBe(crossingBoundaryX(false));
  });

  it("puts the boundary halfway when an ack is expected", () => {
    const { container } = render(
      <RailCrossing
        tags={DEFAULT_RAIL_TAGS}
        progress={0.5}
        label="Launch in flight"
      />,
    );
    const boundary = container.querySelector('[data-role="boundary"]');
    expect(Number(boundary?.getAttribute("x1"))).toBe(crossingBoundaryX(true));
  });

  it("draws a discrete entry as a dot that stops at the boundary", () => {
    const { container } = render(
      <RailCrossing
        tags={SCIENCE_HOME}
        progress={1}
        label="Science result on its way home"
      />,
    );
    const dot = container.querySelector('[data-role="dot"]');
    expect(dot).not.toBeNull();
    expect(Number(dot?.getAttribute("cx"))).toBe(crossingBoundaryX(false));
    expect(container.querySelector('[data-role="ribbon"]')).toBeNull();
  });

  it("lets an acked dot travel the whole track, out and back", () => {
    const { container } = render(
      <RailCrossing tags={DEFAULT_RAIL_TAGS} progress={1} label="Launch" />,
    );
    const dot = container.querySelector('[data-role="dot"]');
    expect(Number(dot?.getAttribute("cx"))).toBeGreaterThan(
      crossingBoundaryX(true),
    );
  });

  it("runs the fade the way the entry does", () => {
    const samples = [0.5, 0.5, 0.5, 0.5];
    const { container: out } = render(
      <RailCrossing tags={FLY_BY_WIRE} amplitudes={samples} label="Pitch" />,
    );
    const { container: inbound } = render(
      <RailCrossing
        tags={VOICE_RAIL_TAGS}
        amplitudes={samples}
        label="Voice"
      />,
    );
    const span = (c: HTMLElement): [number, number] => {
      const g = c.querySelector("linearGradient");
      return [Number(g?.getAttribute("x1")), Number(g?.getAttribute("x2"))];
    };
    // A command leaves this end clear and dissolves toward the target; what
    // arrives is clearest where it lands.
    const [outX1, outX2] = span(out);
    expect(outX1).toBeLessThan(outX2);
    const [inX1, inX2] = span(inbound);
    expect(inX1).toBeGreaterThan(inX2);
  });

  it("gives two mounted crossings their own gradient id", () => {
    const { container } = render(
      <>
        <RailCrossing tags={VOICE_RAIL_TAGS} amplitudes={[0.5]} label="One" />
        <RailCrossing tags={FLY_BY_WIRE} amplitudes={[0.5]} label="Two" />
      </>,
    );
    const ids = Array.from(container.querySelectorAll("linearGradient")).map(
      (g) => g.id,
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("draws nothing for a ribbon with no samples", () => {
    const { container } = render(
      <RailCrossing tags={VOICE_RAIL_TAGS} amplitudes={[]} label="Silent" />,
    );
    expect(container.querySelector("[data-rail-crossing]")).toBeNull();
  });

  it("names itself for assistive tech rather than sitting there unlabelled", async () => {
    const { container } = render(
      <RailCrossing
        tags={VOICE_RAIL_TAGS}
        amplitudes={[0.3, 0.7]}
        label="Your transmission crossing to Odyssey"
      />,
    );
    expect(
      screen.getByRole("img", {
        name: "Your transmission crossing to Odyssey",
      }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
