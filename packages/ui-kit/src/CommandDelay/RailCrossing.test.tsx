import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { crossingBoundaryX, RailCrossing, ribbonPath } from "./RailCrossing";
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

describe("ribbonPath", () => {
  it("puts the newest sample at this end and older ones further out", () => {
    // Newest last in, so 0.9 is `now` and lands at x=0.
    const d = ribbonPath([0.1, 0.9], 1, 100);
    expect(d.startsWith("M0.00,")).toBe(true);
    expect(d).toContain("100.00,");
  });

  it("draws a closed outline, top out and bottom back", () => {
    const d = ribbonPath([0.5, 0.5, 0.5], 2, 100);
    expect(d.endsWith(" Z")).toBe(true);
    // Three samples, both edges: six vertices.
    expect(d.match(/\d+\.\d\d,\d+\.\d\d/g)).toHaveLength(6);
  });

  it("is symmetric about the mid-line, so amplitude reads either way", () => {
    const d = ribbonPath([1], 1, 100);
    expect(d).toContain("0.00,2.50");
    expect(d).toContain("0.00,13.50");
  });

  it("drops samples that have already arrived rather than piling them up", () => {
    const wide = ribbonPath([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 2, 100);
    // span 2 => ages 0,1,2 are still crossing; the three older ones are home.
    expect(wide.match(/\d+\.\d\d,\d+\.\d\d/g)).toHaveLength(6);
  });

  it("is empty with nothing to draw", () => {
    expect(ribbonPath([], 4, 100)).toBe("");
  });

  it("survives a non-finite sample rather than emitting NaN geometry", () => {
    const d = ribbonPath([Number.NaN, 0.5], 1, 100);
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
    const { container: out } = render(
      <RailCrossing tags={FLY_BY_WIRE} amplitudes={[0.5]} label="Pitch" />,
    );
    const { container: inbound } = render(
      <RailCrossing tags={VOICE_RAIL_TAGS} amplitudes={[0.5]} label="Voice" />,
    );
    expect(out.querySelector("linearGradient")?.getAttribute("x1")).toBe("0");
    expect(inbound.querySelector("linearGradient")?.getAttribute("x1")).toBe(
      "1",
    );
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
