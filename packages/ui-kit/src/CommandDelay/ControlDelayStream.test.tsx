import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  ControlDelayStream,
  type ControlRibbonDatum,
  type ControlStreamDatum,
  ribbonBoundaryX,
} from "./ControlDelayStream";

function stream(over: Partial<ControlStreamDatum> = {}): ControlStreamDatum {
  return {
    id: "vessel.control.throttle",
    label: "Throttle",
    oneWaySeconds: 1.6,
    inTransit: [
      { age: 0, value: 0.5 },
      { age: 2.4, value: 0.6 },
      { age: 4.8, value: 0.6 },
    ],
    echo: [{ age: 3.2, value: 0.6 }],
    current: 0.5,
    ...over,
  };
}

describe("ControlDelayStream", () => {
  it("renders nothing when the one-way delay is near zero", () => {
    const { container } = render(
      <ControlDelayStream streams={[stream({ oneWaySeconds: 0.01 })]} />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders nothing with no streams", () => {
    const { container } = render(<ControlDelayStream streams={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("draws the two zone dividers and a commanded path per stream", () => {
    const { container, getByRole } = render(
      <ControlDelayStream
        streams={[
          stream(),
          stream({ id: "vessel.control.pitch", label: "Pitch" }),
        ]}
        ariaLabel="Navball controls in flight"
      />,
    );
    expect(getByRole("img")).toHaveAttribute(
      "aria-label",
      "Navball controls in flight",
    );
    expect(container.querySelectorAll("[data-divider]")).toHaveLength(2);
    expect(container.querySelectorAll('[data-role="commanded"]')).toHaveLength(
      2,
    );
  });

  it("fades the section dividers with the under-line shading (top -> transparent stroke)", () => {
    const { container } = render(<ControlDelayStream streams={[stream()]} />);
    const divider = container.querySelector('[data-divider="t"]');
    // The divider is stroked with the fade gradient, not a flat colour.
    expect(divider?.getAttribute("stroke")).toMatch(/^url\(#cds-divfade-/);
    const grad = container.querySelector('linearGradient[id^="cds-divfade-"]');
    const opacities = Array.from(grad?.querySelectorAll("stop") ?? []).map(
      (s) => Number(s.getAttribute("stop-opacity")),
    );
    // Fades downward: opaque at the top, gone at the bottom, like the shading.
    expect(opacities[0]).toBeGreaterThan(0);
    expect(opacities[opacities.length - 1]).toBe(0);
  });

  it("draws the deviation branch when the echo diverges from the commanded path", () => {
    const diverged = stream({
      echo: [{ age: 3.2, value: 0.95 }],
    });
    const { container } = render(<ControlDelayStream streams={[diverged]} />);
    expect(
      container.querySelector('[data-role="deviation-actual"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-role="deviation-expected"]'),
    ).not.toBeNull();
  });

  it("colours only the echo path from the first diverging sample onward, not the whole path", () => {
    // Three confirmed samples: the first matches the commanded value (no
    // deviation), the second and third diverge past the epsilon. The actual-
    // orange treatment must stem FROM the divergence point (the second
    // sample), not repaint the whole echo path orange.
    const partiallyDiverged = stream({
      inTransit: [
        { age: 0, value: 0.6 },
        { age: 4.8, value: 0.6 },
      ],
      echo: [
        { age: 3.2, value: 0.6 }, // matches: still "confirmed", not deviating
        { age: 4.0, value: 0.95 }, // diverges here
        { age: 4.8, value: 0.95 }, // stays diverged
      ],
    });
    const { container } = render(
      <ControlDelayStream streams={[partiallyDiverged]} />,
    );
    const confirmed = container.querySelector('[data-role="echo"]');
    const deviation = container.querySelector('[data-role="deviation-actual"]');
    const expected = container.querySelector(
      '[data-role="deviation-expected"]',
    );
    expect(confirmed).not.toBeNull();
    expect(deviation).not.toBeNull();
    expect(expected).not.toBeNull();

    // The pre-divergence segment covers exactly the first two samples (the
    // matching one plus the shared vertex where it diverges): one "M" + one
    // "L" = 2 draw commands. It must NOT extend into the diverged region.
    const confirmedCommands = confirmed?.getAttribute("d")?.match(/[ML]/g);
    expect(confirmedCommands).toHaveLength(2);

    // The deviation segment starts AT that same shared vertex and covers the
    // remaining two samples: it must NOT reach back before the divergence.
    const deviationCommands = deviation?.getAttribute("d")?.match(/[ML]/g);
    expect(deviationCommands).toHaveLength(2);

    // Deviation-actual gets the reserved warning treatment; the pre-
    // divergence "echo" segment does not.
    expect(deviation).toHaveAttribute("data-deviation", "true");
    expect(confirmed).not.toHaveAttribute("data-deviation");
    expect(deviation).toHaveAttribute(
      "stroke",
      "var(--color-status-warning-bg)",
    );
    expect(confirmed).not.toHaveAttribute(
      "stroke",
      "var(--color-status-warning-bg)",
    );
  });

  it("begins the confirmed-echo line exactly at the 2T divider (shared boundary, not a stray data age)", () => {
    // Echo's first sample is at age 1.5, BEFORE 2T (=2 for oneWay 1). The
    // confirmed line must still begin at the 2T divider, both derived from the
    // one boundary, so the last-stage transition lands ON the divider.
    const s = stream({
      oneWaySeconds: 1,
      inTransit: [
        { age: 0, value: 0.5 },
        { age: 3, value: 0.5 },
      ],
      echo: [
        { age: 1.5, value: 0.5 },
        { age: 2.5, value: 0.5 },
      ],
    });
    const { container } = render(
      <ControlDelayStream streams={[s]} variant="expanded" />,
    );
    const divX2 = Number(
      container.querySelector('[data-divider="2t"]')?.getAttribute("x1"),
    );
    const echoD =
      container.querySelector('[data-role="echo"]')?.getAttribute("d") ?? "";
    const firstX = Number(echoD.match(/^M([\d.]+),/)?.[1]);
    expect(firstX).toBeCloseTo(divX2, 1);
  });

  it("gives every instance its own gradient id, never colliding across mounted widgets", () => {
    // Two independently-mounted streams (the same shape two Navball
    // instances, or a Navball plus a second control widget, would produce):
    // a hardcoded `cds-ramp-${index}` id collides across them, and one
    // instance's <linearGradient> silently wins for both `url(#...)`
    // references.
    const { container: a } = render(
      <ControlDelayStream streams={[stream()]} />,
    );
    const { container: b } = render(
      <ControlDelayStream streams={[stream()]} />,
    );
    const rampA = a
      .querySelector('linearGradient[id^="cds-ramp-"]')
      ?.getAttribute("id");
    const rampB = b
      .querySelector('linearGradient[id^="cds-ramp-"]')
      ?.getAttribute("id");
    expect(rampA).toBeTruthy();
    expect(rampB).toBeTruthy();
    expect(rampA).not.toBe(rampB);
  });

  it("draws a confidence-ramp gradient from muted (left) to clear (right)", () => {
    const { container } = render(<ControlDelayStream streams={[stream()]} />);
    const gradient = container.querySelector('linearGradient[id^="cds-ramp-"]');
    expect(gradient).not.toBeNull();

    const stops = Array.from(gradient?.querySelectorAll("stop") ?? []);
    expect(stops.length).toBeGreaterThanOrEqual(2);

    const offsets = stops.map((s) => Number(s.getAttribute("offset")));
    const opacities = stops.map((s) => Number(s.getAttribute("stop-opacity")));

    // Muted left, clear right: both offset and opacity strictly ascend.
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBe(1);
    for (let i = 1; i < opacities.length; i++) {
      expect(opacities[i]).toBeGreaterThan(opacities[i - 1]);
    }

    // The commanded path actually rides this gradient, not a flat colour.
    const commanded = container.querySelector('[data-role="commanded"]');
    expect(commanded).toHaveAttribute(
      "stroke",
      `url(#${gradient?.getAttribute("id")})`,
    );
  });

  it("uses the v3 subtle confidence ramp (0.10 -> 0.40 alpha, was 0.30 -> 0.95)", () => {
    const { container } = render(<ControlDelayStream streams={[stream()]} />);
    const gradient = container.querySelector('linearGradient[id^="cds-ramp-"]');
    const stops = Array.from(gradient?.querySelectorAll("stop") ?? []);
    const opacities = stops.map((s) => Number(s.getAttribute("stop-opacity")));
    expect(opacities[0]).toBe(0.1);
    expect(opacities[opacities.length - 1]).toBe(0.4);
  });

  it("draws a soft under-line glow fill (v3 round 6), a gradient not a flat colour", () => {
    const { container } = render(<ControlDelayStream streams={[stream()]} />);
    const area = container.querySelector('[data-role="area"]');
    expect(area).not.toBeNull();
    // Filled with a gradient (the glow), not a solid colour or none.
    expect(area?.getAttribute("fill")).toMatch(/^url\(#cds-fill-/);
    // Its gradient fades top -> transparent bottom.
    const fillGrad = container.querySelector('linearGradient[id^="cds-fill-"]');
    const stops = Array.from(fillGrad?.querySelectorAll("stop") ?? []);
    const opacities = stops.map((s) => Number(s.getAttribute("stop-opacity")));
    expect(opacities[0]).toBeGreaterThan(0);
    expect(opacities[opacities.length - 1]).toBe(0);
  });

  it('renders at the 16px rail size under variant="rail", 40px inline by default', () => {
    const { container: rail } = render(
      <ControlDelayStream streams={[stream()]} variant="rail" />,
    );
    const { container: inline } = render(
      <ControlDelayStream streams={[stream()]} />,
    );
    expect(rail.querySelector("[data-variant]")).toHaveAttribute(
      "data-variant",
      "rail",
    );
    expect(inline.querySelector("[data-variant]")).toHaveAttribute(
      "data-variant",
      "inline",
    );
  });

  it("drops the zone/section labels in rail mode, keeps them inline", () => {
    const { container: rail } = render(
      <ControlDelayStream streams={[stream()]} variant="rail" />,
    );
    const { container: inline } = render(
      <ControlDelayStream streams={[stream()]} />,
    );
    expect(rail.querySelector('[data-role="hover-labels"]')).toBeNull();
    expect(inline.querySelector('[data-role="hover-labels"]')).not.toBeNull();
  });

  it("renders the expanded view taller, full-bleed, with roomy zone labels and a legend", () => {
    const { container } = render(
      <ControlDelayStream
        streams={[
          stream(),
          stream({ id: "vessel.control.pitch", label: "Pitch" }),
        ]}
        variant="expanded"
      />,
    );
    expect(container.querySelector("[data-variant]")).toHaveAttribute(
      "data-variant",
      "expanded",
    );
    // Roomy HTML zone labels (not squashed svg text) + a per-axis legend.
    expect(container.textContent).toContain("outgoing");
    expect(container.textContent).toContain("echo");
    expect(container.textContent).toContain("confirmed");
    expect(container.textContent).toContain("Throttle");
    expect(container.textContent).toContain("Pitch");
    // Full-bleed like the rail: the first divider sits at exactly 1/3.
    const t = Number(
      container.querySelector('[data-divider="t"]')?.getAttribute("x1"),
    );
    expect(t).toBeCloseTo(100 / 3, 1);
    // No hover-only svg label group in the expanded view (labels are HTML).
    expect(container.querySelector('[data-role="hover-labels"]')).toBeNull();
  });

  it("bleeds the graph to the full width in rail mode (no horizontal inset)", () => {
    // padX = 0 in rail, so the first zone divider sits at exactly 1/3 of the
    // full viewBox width; the inline variant keeps a small inset, so its divider
    // is nudged off the exact third.
    const { container: rail } = render(
      <ControlDelayStream
        streams={[stream({ oneWaySeconds: 1 })]}
        variant="rail"
      />,
    );
    const { container: inline } = render(
      <ControlDelayStream streams={[stream({ oneWaySeconds: 1 })]} />,
    );
    const railT = Number(
      rail.querySelector('[data-divider="t"]')?.getAttribute("x1"),
    );
    const inlineT = Number(
      inline.querySelector('[data-divider="t"]')?.getAttribute("x1"),
    );
    expect(railT).toBeCloseTo(100 / 3, 1);
    expect(inlineT).toBeGreaterThan(railT);
  });

  it("has no axe violations", async () => {
    const { container } = render(<ControlDelayStream streams={[stream()]} />);
    await expectNoA11yViolations(container);
  });
});

function ribbon(over: Partial<ControlRibbonDatum> = {}): ControlRibbonDatum {
  return {
    id: "radio.voice",
    label: "Your transmission crossing to Odyssey",
    oneWaySeconds: 1.6,
    amplitudes: [0.2, 0.6, 0.4, 0.8],
    spanSamples: 3,
    ...over,
  };
}

/** Every "x.xx,y.yy" vertex of a path, in order. */
function vertices(d: string): { x: number; y: number }[] {
  return [...d.matchAll(/(-?\d+\.\d\d),(-?\d+\.\d\d)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
}

/**
 * The RIBBON mark, on the one rail. What used to be a second component handed
 * the fire-and-forget row, with its own boundary at 98% of the widget; the
 * regression the operator named was that the second rail REPLACED the strip
 * they had asked to grow, and these are the ratchets on it not coming back.
 */
describe("the ribbon mark", () => {
  it("draws a continuous entry with no readback on the ONE graph", () => {
    const { container } = render(
      <ControlDelayStream streams={[]} ribbons={[ribbon()]} />,
    );
    // The graph itself, dividers and all: not a different picture.
    expect(container.querySelectorAll("[data-divider]")).toHaveLength(2);
    expect(container.querySelector('[data-role="ribbon"]')).not.toBeNull();
    // And nothing an ack would have drawn.
    expect(container.querySelector('[data-role="echo"]')).toBeNull();
    expect(
      container.querySelector('[data-role="deviation-actual"]'),
    ).toBeNull();
  });

  it("keeps the trace inside the OUTGOING zone, the boundary staying on the T divider", () => {
    /*
     * The whole of the operator's complaint about the second rail: voice belongs
     * to the leg out, and the divider sits a third of the way across whether or
     * not anything comes back. A full ring at this separation therefore reaches
     * the T divider and stops there, never 98% of the widget.
     */
    const { container } = render(
      <ControlDelayStream
        streams={[]}
        ribbons={[
          ribbon({ amplitudes: new Array(129).fill(0.6), spanSamples: 128 }),
        ]}
        variant="rail"
      />,
    );
    const d =
      container.querySelector('[data-role="ribbon"]')?.getAttribute("d") ?? "";
    const pts = vertices(d);
    const boundary = ribbonBoundaryX("rail");
    expect(pts[pts.length - 1].x).toBeCloseTo(boundary, 1);
    const divider = container.querySelector('[data-divider="t"]');
    expect(Number(divider?.getAttribute("x1"))).toBeCloseTo(boundary, 5);
  });

  it("strokes the voice as a trace rather than filling it as a blob", () => {
    const { container } = render(
      <ControlDelayStream streams={[]} ribbons={[ribbon()]} />,
    );
    const trace = container.querySelector('[data-role="ribbon"]');
    expect(trace?.getAttribute("fill")).toBe("none");
    expect(trace?.getAttribute("stroke")).toMatch(/^url\(#/);
    /*
     * The box is stretched to the widget's width AND scaled vertically into the
     * plot band, so a scaled stroke would come out several times thicker across
     * than it is tall: the pen the operator already objected to, back by another
     * route.
     */
    expect(trace?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });

  it("draws nothing for a ribbon with no samples", () => {
    const { container } = render(
      <ControlDelayStream
        streams={[]}
        ribbons={[ribbon({ amplitudes: [] })]}
      />,
    );
    expect(container.querySelector('[data-role="ribbon"]')).toBeNull();
  });

  it("draws no ribbon for an entry tagged DISCRETE, the continuity axis deciding the mark", () => {
    const { container } = render(
      <ControlDelayStream
        streams={[]}
        ribbons={[ribbon({ tags: { continuity: "discrete" } })]}
      />,
    );
    expect(container.querySelector('[data-role="ribbon"]')).toBeNull();
  });

  it("runs the fade the way the entry does, the direction axis deciding", () => {
    const span = (c: HTMLElement): [number, number] => {
      const g = c.querySelector("[data-ribbon-group] linearGradient");
      return [Number(g?.getAttribute("x1")), Number(g?.getAttribute("x2"))];
    };
    // Telemetry arrives, so it is clearest where it lands.
    const { container: inbound } = render(
      <ControlDelayStream streams={[]} ribbons={[ribbon()]} />,
    );
    const [inX1, inX2] = span(inbound);
    expect(inX1).toBeGreaterThan(inX2);
    // A command leaves this end clear and dissolves toward its target.
    const { container: out } = render(
      <ControlDelayStream
        streams={[]}
        ribbons={[ribbon({ tags: { direction: "command" } })]}
      />,
    );
    const [outX1, outX2] = span(out);
    expect(outX1).toBeLessThan(outX2);
  });

  it("gives two mounted ribbons their own gradient id", () => {
    const { container } = render(
      <>
        <ControlDelayStream streams={[]} ribbons={[ribbon()]} />
        <ControlDelayStream streams={[]} ribbons={[ribbon()]} />
      </>,
    );
    const ids = Array.from(
      container.querySelectorAll("[data-ribbon-group] linearGradient"),
    ).map((g) => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("shares one graph with a control axis rather than replacing it", () => {
    const { container } = render(
      <ControlDelayStream streams={[stream()]} ribbons={[ribbon()]} />,
    );
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(container.querySelector('[data-role="commanded"]')).not.toBeNull();
    expect(container.querySelector('[data-role="ribbon"]')).not.toBeNull();
  });

  it("carries the ribbon's own name for assistive tech", async () => {
    const { container, getByRole } = render(
      <ControlDelayStream
        streams={[]}
        ribbons={[ribbon()]}
        ariaLabel="Your transmission crossing to Odyssey"
      />,
    );
    expect(
      getByRole("img", { name: "Your transmission crossing to Odyssey" }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("draws nothing when there is no light-time to cross", () => {
    const { container } = render(
      <ControlDelayStream
        streams={[]}
        ribbons={[ribbon({ oneWaySeconds: 0.01 })]}
      />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});

/**
 * DELIVERY decides whether a return leg is drawn, and nothing else. It does not
 * move a boundary and it does not pick a different component: that was the
 * regression, and `railTags.test.ts` has always said so in prose.
 */
describe("delivery decides the return leg and nothing else", () => {
  it("gives a fire-and-forget stream the leg out and stops it on the T divider", () => {
    const { container } = render(
      <ControlDelayStream
        streams={[stream({ tags: { delivery: "fire-and-forget" } })]}
      />,
    );
    const group = container.querySelector("[data-stream-group]");
    expect(group?.getAttribute("data-return-leg")).toBe("false");
    expect(container.querySelector('[data-role="echo"]')).toBeNull();
    const d =
      container.querySelector('[data-role="commanded"]')?.getAttribute("d") ??
      "";
    const pts = vertices(d);
    const divider = Number(
      container.querySelector('[data-divider="t"]')?.getAttribute("x1"),
    );
    expect(pts[pts.length - 1].x).toBeCloseTo(divider, 1);
  });

  it("leaves the zones exactly where they were, delivery or no", () => {
    const at = (tags?: Partial<ControlStreamDatum["tags"]>): string[] => {
      const { container } = render(
        <ControlDelayStream streams={[stream({ tags })]} variant="rail" />,
      );
      return Array.from(container.querySelectorAll("[data-divider]")).map(
        (l) => l.getAttribute("x1") ?? "",
      );
    };
    expect(at({ delivery: "fire-and-forget" })).toEqual(at(undefined));
  });

  it("keeps an acked stream's echo and deviation untouched", () => {
    const { container } = render(
      <ControlDelayStream
        streams={[
          stream({
            echo: [
              { age: 3.2, value: 0.6 },
              { age: 4.8, value: 0.1 },
            ],
          }),
        ]}
      />,
    );
    expect(
      container
        .querySelector("[data-stream-group]")
        ?.getAttribute("data-return-leg"),
    ).toBe("true");
    expect(container.querySelector('[data-role="echo"]')).not.toBeNull();
    expect(
      container.querySelector('[data-role="deviation-actual"]'),
    ).not.toBeNull();
  });
});
