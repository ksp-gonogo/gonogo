import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  canDrawEnvelope,
  classifyUrgency,
  DescentEnvelope,
} from "./DescentEnvelope";

describe("canDrawEnvelope", () => {
  const ok = {
    currentSpeed: 200,
    currentAltitude: 8000,
    terminalVelocity: 120,
    projectedTouchdownSpeed: 88,
  };

  it("needs both terminal anchors + a positive altitude span", () => {
    expect(canDrawEnvelope(ok)).toBe(true);
    expect(canDrawEnvelope({ ...ok, terminalVelocity: null })).toBe(false);
    expect(canDrawEnvelope({ ...ok, projectedTouchdownSpeed: null })).toBe(
      false,
    );
    expect(canDrawEnvelope({ ...ok, currentAltitude: 0 })).toBe(false);
    expect(canDrawEnvelope({ ...ok, terminalVelocity: Number.NaN })).toBe(
      false,
    );
  });

  it("does not require currentSpeed (the envelope draws without the marker)", () => {
    expect(canDrawEnvelope({ ...ok, currentSpeed: null })).toBe(true);
  });
});

describe("classifyUrgency", () => {
  it("is SAFE whenever the do-nothing touchdown is survivable, regardless of altitude", () => {
    expect(classifyUrgency(8, 50)).toBe("safe");
    expect(classifyUrgency(12, 50)).toBe("safe"); // boundary, inclusive
    expect(classifyUrgency(8, 40000)).toBe("safe");
  });

  it("is URGENT only when the touchdown is lethal AND altitude is critically low", () => {
    expect(classifyUrgency(95, 550)).toBe("urgent");
    expect(classifyUrgency(45, 1500)).toBe("urgent"); // both boundaries, inclusive
  });

  it("is CAUTION for a lethal touchdown with altitude/time left to act", () => {
    expect(classifyUrgency(95, 1600)).toBe("caution");
    expect(classifyUrgency(95, 40000)).toBe("caution");
  });

  it("is CAUTION for a hard-but-not-lethal touchdown at any altitude", () => {
    expect(classifyUrgency(25, 50)).toBe("caution");
    expect(classifyUrgency(25, 40000)).toBe("caution");
  });
});

describe("DescentEnvelope", () => {
  it("renders nothing when the anchors are missing", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={8000}
        terminalVelocity={null}
        projectedTouchdownSpeed={88}
      />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("reads ABOVE terminal when current speed exceeds terminal velocity", () => {
    const { getByRole } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
      />,
    );
    // The accessible label carries the numbers + the regime (never picture-only).
    const svg = getByRole("img");
    expect(svg.getAttribute("aria-label")).toMatch(/above terminal/i);
    expect(svg.getAttribute("aria-label")).toMatch(/200 m\/s/);
    expect(svg.getAttribute("aria-label")).toMatch(/touchdown 95 m\/s/i);
  });

  it("reads BELOW terminal when current speed is under terminal velocity", () => {
    const { getByRole } = render(
      <DescentEnvelope
        currentSpeed={600}
        currentAltitude={35000}
        terminalVelocity={1400}
        projectedTouchdownSpeed={8}
      />,
    );
    expect(getByRole("img").getAttribute("aria-label")).toMatch(
      /below terminal/i,
    );
  });

  it("carries the urgency word in the accessible label, never colour-only", () => {
    const { getByRole } = render(
      <DescentEnvelope
        currentSpeed={95}
        currentAltitude={550}
        terminalVelocity={110}
        projectedTouchdownSpeed={95}
      />,
    );
    expect(getByRole("img").getAttribute("aria-label")).toMatch(
      /urgent, slow now/i,
    );
  });

  it("draws exactly one vessel marker, as a dot (no crosshairs)", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
      />,
    );
    // The vessel marker is a plain filled circle; nothing else in the SVG
    // renders a `<line>` (the old crosshairs are gone) or a second `<circle>`
    // (the old touchdown crosshair is gone, the plot's bottom edge is ground).
    expect(container.querySelectorAll("svg line")).toHaveLength(0);
    expect(container.querySelectorAll("svg circle")).toHaveLength(1);
  });

  it("omits the marker (but still draws the curve) without a current speed", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={null}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
      />,
    );
    expect(container.querySelectorAll("svg circle")).toHaveLength(0);
    expect(container.querySelector("svg polyline")).not.toBeNull();
  });

  it("colours the dot GREEN for a survivable do-nothing touchdown", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={100}
        currentAltitude={3000}
        terminalVelocity={120}
        projectedTouchdownSpeed={8}
      />,
    );
    const dot = container.querySelector("svg circle");
    expect(dot?.getAttribute("fill")).toBe("var(--color-accent-fg)");
  });

  it("colours the dot RED when the touchdown is lethal and altitude is critical", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={100}
        currentAltitude={550}
        terminalVelocity={120}
        projectedTouchdownSpeed={95}
      />,
    );
    const dot = container.querySelector("svg circle");
    expect(dot?.getAttribute("fill")).toBe("var(--color-status-nogo-bg)");
  });

  it("colours the dot AMBER for a lethal touchdown with altitude/time to act", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={100}
        currentAltitude={30000}
        terminalVelocity={120}
        projectedTouchdownSpeed={95}
      />,
    );
    const dot = container.querySelector("svg circle");
    expect(dot?.getAttribute("fill")).toBe("var(--color-status-warning-bg)");
  });

  it("thickens the terminal-velocity curve stroke", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
      />,
    );
    const curve = container.querySelector("svg polyline");
    expect(curve?.getAttribute("stroke-width")).toBe("4");
  });

  it("colours the reference curve differently from the SAFE action dot (never blend the two)", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={100}
        currentAltitude={3000}
        terminalVelocity={120}
        projectedTouchdownSpeed={8}
      />,
    );
    const curve = container.querySelector("svg polyline");
    const dot = container.querySelector("svg circle");
    // The dot is SAFE here (touchdown well under SURVIVABLE_TOUCHDOWN_MPS),
    // so it wears the accent green. The curve is a reference line, not an
    // action element, so it must be a distinct, neutral tone rather than
    // sharing that green, or the SAFE dot would blend straight into it.
    expect(dot?.getAttribute("fill")).toBe("var(--color-accent-fg)");
    expect(curve?.getAttribute("stroke")).not.toBe(dot?.getAttribute("fill"));
    expect(curve?.getAttribute("stroke")).toBe("var(--color-text-muted)");
  });

  it("keeps the curve colour distinct from CAUTION and URGENT dots too", () => {
    const { container: caution } = render(
      <DescentEnvelope
        currentSpeed={100}
        currentAltitude={30000}
        terminalVelocity={120}
        projectedTouchdownSpeed={95}
      />,
    );
    const { container: urgent } = render(
      <DescentEnvelope
        currentSpeed={100}
        currentAltitude={550}
        terminalVelocity={120}
        projectedTouchdownSpeed={95}
      />,
    );
    for (const container of [caution, urgent]) {
      const curve = container.querySelector("svg polyline");
      const dot = container.querySelector("svg circle");
      expect(curve?.getAttribute("stroke")).toBe("var(--color-text-muted)");
      expect(curve?.getAttribute("stroke")).not.toBe(dot?.getAttribute("fill"));
    }
  });

  it("gives each instance its own atmosphere-gradient id (no cross-widget id collisions)", () => {
    const { container: a } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
      />,
    );
    const { container: b } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
      />,
    );
    const idA = a.querySelector("linearGradient")?.id;
    const idB = b.querySelector("linearGradient")?.id;
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
  });

  it("labels the touchdown value as TOUCHDOWN SPEED + unit, not the cryptic 'td' abbreviation", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
      />,
    );
    const texts = Array.from(container.querySelectorAll("svg text")).map(
      (t) => t.textContent,
    );
    expect(texts).toContain("TOUCHDOWN SPEED");
    expect(texts).toContain("95 m/s");
    // Never the bare abbreviation as its own token (case-insensitive), the
    // full phrase "TOUCHDOWN SPEED" containing "td" as a substring is fine.
    expect(texts).not.toContain("td");
    expect(texts).not.toContain("td 95");
  });

  it("puts the urgency word bottom-left, clear of the top band the dot always sits in", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={95}
        currentAltitude={550}
        terminalVelocity={110}
        projectedTouchdownSpeed={95}
      />,
    );
    const wordText = Array.from(container.querySelectorAll("svg text")).find(
      (t) => t.textContent === "URGENT",
    );
    expect(wordText).toBeTruthy();
    // Left-aligned near the left edge (not right-anchored near the top-right
    // corner, where the vessel dot always sits by construction).
    expect(wordText?.getAttribute("text-anchor")).not.toBe("end");
    expect(Number(wordText?.getAttribute("x"))).toBeLessThan(20);
    // Bottom row, not the top row the altitude readout occupies.
    expect(Number(wordText?.getAttribute("y"))).toBeGreaterThan(100);
  });

  it("backs HUD labels with a soft shadow filter, never a solid stroke halo", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
      />,
    );
    const labels = container.querySelectorAll("svg > text");
    expect(labels.length).toBeGreaterThan(0);
    for (const t of Array.from(labels)) {
      expect(t.getAttribute("stroke")).toBeNull();
      expect(t.getAttribute("filter")).toMatch(/^url\(#/);
    }
    // The filter itself is a drop-shadow, not an outline/halo technique.
    expect(container.querySelector("filter feDropShadow")).not.toBeNull();
  });

  it("clips the full-bleed plot content to a rounded rect matching the container", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
      />,
    );
    const clipRect = container.querySelector("clipPath rect");
    expect(clipRect).not.toBeNull();
    expect(clipRect?.getAttribute("rx")).not.toBe("0");
    // The haze/curve/dot content sits inside a clipped group…
    const clippedGroup = container.querySelector("g[clip-path]");
    expect(clippedGroup).not.toBeNull();
    expect(clippedGroup?.querySelector("polyline")).not.toBeNull();
    expect(clippedGroup?.querySelector("circle")).not.toBeNull();
  });

  it("draws the HUD text labels over the plot, not clipped underneath it", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
      />,
    );
    // None of the readout text lives inside the clipped content group, they
    // are separate, later-painted siblings, so they're never clipped and
    // always paint on top (SVG paints in document order).
    const clippedGroup = container.querySelector("g[clip-path]");
    expect(clippedGroup?.querySelector("text")).toBeNull();
    // altitude, urgency word, TOUCHDOWN label, touchdown value.
    expect(container.querySelectorAll("svg > text")).toHaveLength(4);
  });

  it("makes the atmosphere haze actually visible at the ground, not near-invisible", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
      />,
    );
    const stops = Array.from(container.querySelectorAll("stop"));
    expect(stops.length).toBeGreaterThan(0);
    const opacities = stops.map((s) => Number(s.getAttribute("stop-opacity")));
    // Peak (ground) opacity must clear a "you can actually see it" floor,
    // guards against regressing back toward the old, effectively-invisible
    // 0.08 peak, the later still-subtle 0.24 peak, and the 0.36 peak that
    // read fine on the widget's old own `surface-raised` background but
    // washed out once the plot moved onto the frame's darker
    // `surface-sunken` with no background of its own.
    expect(Math.max(...opacities)).toBeGreaterThanOrEqual(0.45);
  });

  it("backs the banded haze with a subtle flat base tint so it still reads where the banding fades", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
        atmosphereColor="#5a8fd8"
      />,
    );
    const clippedGroup = container.querySelector("g[clip-path]");
    // The base tint is a flat-fill rect (not the `url(#...)` gradient rect),
    // painted in the same body colour, sitting behind the banded gradient.
    const baseTint = clippedGroup?.querySelector('rect[fill="#5a8fd8"]');
    expect(baseTint).not.toBeNull();
    expect(Number(baseTint?.getAttribute("fill-opacity"))).toBeGreaterThan(0);
    expect(Number(baseTint?.getAttribute("fill-opacity"))).toBeLessThan(0.3);
  });

  it("fades the haze toward nothing near the top when the plot spans a wide altitude range", () => {
    // A wide terminal/touchdown ratio (thin air is MUCH thinner than ground)
    // means the top of the plot really is thin air, the haze should read
    // close to zero there, not a uniform wash top-to-bottom.
    const { container } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={35000}
        terminalVelocity={1400}
        projectedTouchdownSpeed={7.5}
      />,
    );
    const opacities = Array.from(container.querySelectorAll("stop")).map((s) =>
      Number(s.getAttribute("stop-opacity")),
    );
    expect(Math.min(...opacities)).toBeLessThan(0.05);
  });

  it("softens the atmosphere bands with a blur filter rather than hard stripes", () => {
    const { container } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
      />,
    );
    expect(container.querySelector("filter feGaussianBlur")).not.toBeNull();
    const hazeRect = container.querySelector('g[clip-path] rect[fill^="url("]');
    expect(hazeRect?.getAttribute("filter")).toMatch(/^url\(#/);
  });

  it("tints the haze with the body's atmosphere colour when one is supplied", () => {
    // Kerbin's registered atmosphereColor (stock-bodies.ts), passed in as
    // the widget's caller (LandingStatus/index.tsx) already resolves it, so
    // the component itself just needs to use it.
    const kerbinBlue = "#5a8fd8";
    const { container } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
        atmosphereColor={kerbinBlue}
      />,
    );
    const stopColors = Array.from(container.querySelectorAll("stop")).map((s) =>
      s.getAttribute("stop-color"),
    );
    expect(stopColors.length).toBeGreaterThan(0);
    expect(stopColors.every((c) => c === kerbinBlue)).toBe(true);
  });

  it("falls back to the neutral blue-slate default for an unknown/airless body", () => {
    const { container: withNull } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
        atmosphereColor={null}
      />,
    );
    const { container: withoutProp } = render(
      <DescentEnvelope
        currentSpeed={200}
        currentAltitude={3000}
        terminalVelocity={105}
        projectedTouchdownSpeed={95}
      />,
    );
    for (const container of [withNull, withoutProp]) {
      const stopColors = Array.from(container.querySelectorAll("stop")).map(
        (s) => s.getAttribute("stop-color"),
      );
      expect(stopColors.length).toBeGreaterThan(0);
      expect(stopColors.every((c) => c === "var(--color-status-info-fg)")).toBe(
        true,
      );
      // And it's distinct from a known atmospheric body's colour.
      expect(stopColors).not.toContain("#5a8fd8");
    }
  });
});
