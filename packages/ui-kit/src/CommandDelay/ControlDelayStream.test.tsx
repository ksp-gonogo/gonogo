import {
  railTagsForCommand,
  railTagsForControlAxis,
  railTagsForTelemetry,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeQuantity } from "../units";
import {
  ControlDelayStream,
  type ControlRibbonDatum,
  type ControlStreamDatum,
  ribbonBoundaryX,
} from "./ControlDelayStream";
import { type RailTags, resetUnrepresentedRailReports } from "./railTags";

// The axes come from the production derivations, so the fixtures follow them rather than asserting stale literals.
const AXIS_TAGS = railTagsForControlAxis("vessel.control.setThrottle");
const VOICE_TAGS = railTagsForTelemetry("continuous");
const DISCRETE_COMMAND_TAGS = railTagsForCommand("vessel.control.setSasMode");

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
    tags: AXIS_TAGS,
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

  it("writes the stage-boundary delays as plain SVG text, which an HTML span inside would not draw", () => {
    const { container } = render(
      <ControlDelayStream streams={[stream({ oneWaySeconds: 1.6 })]} />,
    );
    const labels = [
      ...container.querySelectorAll('[data-role="hover-labels"] text'),
    ];
    const delays = labels.slice(0, 2);
    expect(delays.map((t) => t.textContent)).toEqual([
      writeQuantity(value("s", 1.6), { decimals: 1 }),
      writeQuantity(value("s", 3.2), { decimals: 1 }),
    ]);
    expect(delays.every((t) => t.textContent !== "")).toBe(true);
    for (const t of delays) expect(t.children).toHaveLength(0);
  });

  it("names the graph once, on the image, not again on the box around it", () => {
    const { container } = render(
      <ControlDelayStream
        streams={[stream()]}
        ariaLabel="Throttle in flight"
      />,
    );
    expect(
      container.querySelectorAll('[aria-label="Throttle in flight"]'),
    ).toHaveLength(1);
    expect(
      screen.getByRole("img", { name: "Throttle in flight" }),
    ).toBeTruthy();
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
    // Fades downward, like the shading.
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
    // The first sample matches, the next two diverge: the warning treatment starts at the divergence, not the whole path.
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

    // The pre-divergence segment is the matching sample plus the shared vertex: one "M" and one "L".
    const confirmedCommands = confirmed?.getAttribute("d")?.match(/[ML]/g);
    expect(confirmedCommands).toHaveLength(2);

    // The deviation segment starts at that shared vertex and never reaches back before it.
    const deviationCommands = deviation?.getAttribute("d")?.match(/[ML]/g);
    expect(deviationCommands).toHaveLength(2);

    // Only the deviation segment gets the warning treatment.
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
    // The first echo sample precedes 2T, yet the confirmed line still begins on the 2T divider.
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
    // Two mounted instances must not share a gradient id, or one wins both `url(#...)` references.
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
    // HTML zone labels and a per-axis legend.
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
    // The rail bleeds to the edges, so its divider sits at exactly a third; inline keeps an inset.
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
    tags: VOICE_TAGS,
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

// The RIBBON mark is drawn on the one rail, never a second one.
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
    // Voice belongs to the leg out, so a full ring reaches the T divider and stops there.
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
    // The box is stretched non-uniformly, so a scaled stroke would come out distorted.
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
        ribbons={[ribbon({ tags: DISCRETE_COMMAND_TAGS })]}
      />,
    );
    expect(container.querySelector('[data-role="ribbon"]')).toBeNull();
    // Not reported as a gap: a discrete acked command has a renderer, the queue's.
    expect(container.querySelector("[data-rail-unrepresented]")).toBeNull();
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
        ribbons={[ribbon({ tags: AXIS_TAGS })]}
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

// DELIVERY decides whether a return leg is drawn, and nothing else: no boundary moves and no other component draws it.
describe("delivery decides the return leg and nothing else", () => {
  it("gives a fire-and-forget stream the leg out and stops it on the T divider", () => {
    const { container } = render(
      <ControlDelayStream streams={[stream({ tags: VOICE_TAGS })]} />,
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
    const at = (tags: ControlStreamDatum["tags"]): string[] => {
      const { container } = render(
        <ControlDelayStream streams={[stream({ tags })]} variant="rail" />,
      );
      return Array.from(container.querySelectorAll("[data-divider]")).map(
        (l) => l.getAttribute("x1") ?? "",
      );
    };
    expect(at(VOICE_TAGS)).toEqual(at(AXIS_TAGS));
  });

  // A leg that stopped dead on the divider would read as the signal halting at the target rather than arriving.
  describe("the trailing hint past the divider", () => {
    it("continues the leg past the T divider and stops well short of 2T", () => {
      const { container } = render(
        <ControlDelayStream streams={[stream({ tags: VOICE_TAGS })]} />,
      );
      const tail = vertices(
        container
          .querySelector('[data-role="commanded-tail"]')
          ?.getAttribute("d") ?? "",
      );
      const t = Number(
        container.querySelector('[data-divider="t"]')?.getAttribute("x1"),
      );
      const twoT = Number(
        container.querySelector('[data-divider="2t"]')?.getAttribute("x1"),
      );
      expect(tail.length).toBeGreaterThan(1);
      expect(tail[0].x).toBeCloseTo(t, 1);
      expect(tail[tail.length - 1].x).toBeGreaterThan(t);
      expect(tail[tail.length - 1].x).toBeLessThan(twoT);
    });

    it("starts on the vertex the solid leg ends on, so the two read as one line", () => {
      const { container } = render(
        <ControlDelayStream streams={[stream({ tags: VOICE_TAGS })]} />,
      );
      const solid = vertices(
        container.querySelector('[data-role="commanded"]')?.getAttribute("d") ??
          "",
      );
      const tail = vertices(
        container
          .querySelector('[data-role="commanded-tail"]')
          ?.getAttribute("d") ?? "",
      );
      const end = solid[solid.length - 1];
      expect(tail[0].x).toBeCloseTo(end.x, 5);
      expect(tail[0].y).toBeCloseTo(end.y, 5);
    });

    it("fades to nothing rather than ending at full strength", () => {
      const { container } = render(
        <ControlDelayStream streams={[stream({ tags: VOICE_TAGS })]} />,
      );
      const ref = container
        .querySelector('[data-role="commanded-tail"]')
        ?.getAttribute("stroke");
      const id = /url\(#(.+)\)/.exec(ref ?? "")?.[1];
      // By id, since a `useId()` value is not a valid CSS identifier.
      const grad = Array.from(
        container.querySelectorAll("linearGradient"),
      ).find((g) => g.getAttribute("id") === id);
      const stops = Array.from(grad?.querySelectorAll("stop") ?? []).map((s) =>
        s.getAttribute("stop-opacity"),
      );
      expect(stops).toEqual(["0.40", "0"]);
    });

    it("leaves the dividers exactly where they were", () => {
      const at = (tags: ControlStreamDatum["tags"]): string[] => {
        const { container } = render(
          <ControlDelayStream streams={[stream({ tags })]} variant="rail" />,
        );
        return Array.from(container.querySelectorAll("[data-divider]")).map(
          (l) => l.getAttribute("x1") ?? "",
        );
      };
      expect(at(VOICE_TAGS)).toEqual(at(AXIS_TAGS));
    });

    it("draws no tail for an acked entry, which has a real return leg instead", () => {
      const { container } = render(
        <ControlDelayStream streams={[stream({ tags: AXIS_TAGS })]} />,
      );
      expect(
        container.querySelector('[data-role="commanded-tail"]'),
      ).toBeNull();
    });

    it("moves no sample: x is still the age, read against the acked leg", () => {
      const commanded = (tags: ControlStreamDatum["tags"]) => {
        const { container } = render(
          <ControlDelayStream streams={[stream({ tags })]} />,
        );
        return {
          solid: vertices(
            container
              .querySelector('[data-role="commanded"]')
              ?.getAttribute("d") ?? "",
          ),
          tail: vertices(
            container
              .querySelector('[data-role="commanded-tail"]')
              ?.getAttribute("d") ?? "",
          ),
        };
      };
      const acked = commanded(AXIS_TAGS);
      const fnf = commanded(VOICE_TAGS);
      // Both legs start from the same sample at age 0, so it lands on the same x.
      expect(fnf.solid[0].x).toBeCloseTo(acked.solid[0].x, 5);
      // Ascending: a tail that doubled back would be a return leg.
      for (let i = 1; i < fnf.tail.length; i++) {
        expect(fnf.tail[i].x).toBeGreaterThan(fnf.tail[i - 1].x);
      }
    });
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

// A combination nothing draws is LOUD rather than blank: reported for the developer and marked in the DOM.
describe("an entry nothing can draw", () => {
  afterEach(() => {
    resetUnrepresentedRailReports();
    vi.restoreAllMocks();
  });

  // Telemetry has no reply channel, so no producer can make this one.
  const UNDRAWN: RailTags = {
    direction: "telemetry",
    continuity: "continuous",
    delivery: "acked",
  };

  it("marks the gap in place of the trace, and draws no ink", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <ControlDelayStream
        streams={[]}
        ribbons={[ribbon({ id: "echoed.downlink", tags: UNDRAWN })]}
      />,
    );
    const mark = container.querySelector("[data-rail-unrepresented]");
    expect(mark?.getAttribute("data-rail-unrepresented")).toBe(
      "telemetry/continuous/acked",
    );
    expect(mark?.getAttribute("data-rail-entry")).toBe("echoed.downlink");
    // Zero ink, so a represented entry beside it is unaffected.
    expect(container.querySelector('[data-role="ribbon"]')).toBeNull();
    expect(mark?.children).toHaveLength(0);
    expect(errors).toHaveBeenCalledOnce();
    expect(errors.mock.calls[0][0]).toContain("telemetry/continuous/acked");
    expect(errors.mock.calls[0][0]).toContain("echoed.downlink");
  });

  it("says it ONCE per combination, not once per frame", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ControlDelayStream
        streams={[]}
        ribbons={[
          ribbon({ id: "a", tags: UNDRAWN }),
          ribbon({ id: "b", tags: UNDRAWN }),
        ]}
      />,
    );
    expect(errors).toHaveBeenCalledOnce();
  });

  it("still draws the represented entries beside it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <ControlDelayStream
        streams={[stream()]}
        ribbons={[ribbon({ id: "echoed.downlink", tags: UNDRAWN })]}
      />,
    );
    expect(container.querySelector('[data-role="commanded"]')).not.toBeNull();
    expect(container.querySelector("[data-rail-unrepresented]")).not.toBeNull();
  });
});
