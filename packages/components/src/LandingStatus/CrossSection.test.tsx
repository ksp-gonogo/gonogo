import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { CrossSection } from "./CrossSection";

// A 4x4 patch with a clear high/low split so the sliced profile is non-flat.
const patch = [0, 1, 4, 9, 1, 2, 5, 10, 4, 5, 8, 13, 9, 10, 13, 18];

describe("CrossSection", () => {
  it("renders a labelled side-on velocity image with descent + ground speed", () => {
    render(
      <CrossSection
        patch={patch}
        patchSize={4}
        bearingDeg={90}
        verticalSpeed={40}
        horizontalSpeed={15}
      />,
    );
    const img = screen.getByRole("img", {
      name: /descent .*ground speed/i,
    });
    expect(img.getAttribute("aria-label")).toMatch(/40 m\/s/);
    expect(img.getAttribute("aria-label")).toMatch(/ground speed 15 m\/s/i);
  });

  it("descends the vessel toward the terrain as altitude drops", () => {
    const vesselCy = (container: HTMLElement): number => {
      // The vessel is the r=3 dot (SiteMarker uses r=5 / r=1.4, never r=3).
      const dot = [...container.querySelectorAll("circle")].find(
        (el) => el.getAttribute("r") === "3",
      );
      return Number(dot?.getAttribute("cy"));
    };
    const high = render(
      <CrossSection
        patch={patch}
        patchSize={4}
        bearingDeg={90}
        verticalSpeed={40}
        horizontalSpeed={5}
        aglMeters={6000}
      />,
    );
    const highCy = vesselCy(high.container);
    high.unmount();
    const low = render(
      <CrossSection
        patch={patch}
        patchSize={4}
        bearingDeg={90}
        verticalSpeed={40}
        horizontalSpeed={5}
        aglMeters={60}
      />,
    );
    const lowCy = vesselCy(low.container);
    // Higher altitude ⇒ vessel drawn higher on screen ⇒ smaller y.
    expect(highCy).toBeLessThan(lowCy);
  });

  it("draws only the top terrain line (open skyline), with no bottom/closure line", () => {
    const { container } = render(
      <CrossSection
        patch={patch}
        patchSize={4}
        bearingDeg={90}
        verticalSpeed={40}
        horizontalSpeed={5}
        aglMeters={2000}
      />,
    );
    // The terrain skyline is an OPEN polyline (top surface only), not a stroked
    // closed shape.
    expect(container.querySelector("polyline")).not.toBeNull();
    // Any soft fill polygon carries no stroke, so there is no perimeter/bottom
    // line drawn around the terrain.
    for (const poly of container.querySelectorAll("polygon")) {
      const stroke = poly.getAttribute("stroke");
      expect(stroke === null || stroke === "none").toBe(true);
    }
    // No full-width horizontal baseline along the bottom of the plot.
    const bottomBaseline = [...container.querySelectorAll("line")].some(
      (ln) => {
        const y1 = ln.getAttribute("y1");
        const y2 = ln.getAttribute("y2");
        return y1 === y2 && Number(y1) >= 140; // baseY = SIZE-16 = 144
      },
    );
    expect(bottomBaseline).toBe(false);
  });

  it("fills the ground down to the bottom edge of the square (no abrupt stop)", () => {
    const { container } = render(
      <CrossSection
        patch={patch}
        patchSize={4}
        bearingDeg={90}
        verticalSpeed={40}
        horizontalSpeed={5}
        aglMeters={2000}
      />,
    );
    const fill = container.querySelector("polygon");
    expect(fill).not.toBeNull();
    const ys = (fill?.getAttribute("points") ?? "")
      .split(/\s+/)
      .map((p) => Number(p.split(",")[1]))
      .filter((n) => Number.isFinite(n));
    // The fill reaches the bottom edge of the plot square (SIZE=160, bottom ≈ 156),
    // rather than stopping at the terrain baseline (144).
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(150);
  });

  it("converges the side-on vessel onto the site as drift shrinks to zero", () => {
    const cx = (container: HTMLElement, r: string): number =>
      Number(
        [...container.querySelectorAll("circle")]
          .find((c) => c.getAttribute("r") === r)
          ?.getAttribute("cx"),
      );
    // Far downrange: vessel sits well upwind of the site (large horizontal gap).
    const far = render(
      <CrossSection
        patch={patch}
        patchSize={4}
        bearingDeg={90}
        verticalSpeed={40}
        horizontalSpeed={30}
        aglMeters={4000}
        driftMeters={3000}
      />,
    );
    const farGap = Math.abs(cx(far.container, "3") - cx(far.container, "5"));
    far.unmount();
    // At touchdown drift is ~0: the vessel (r=3) coincides with the site
    // marker (ring r=5): no miss.
    const near = render(
      <CrossSection
        patch={patch}
        patchSize={4}
        bearingDeg={90}
        verticalSpeed={2}
        horizontalSpeed={0}
        aglMeters={5}
        driftMeters={0}
      />,
    );
    const nearGap = Math.abs(cx(near.container, "3") - cx(near.container, "5"));
    expect(nearGap).toBeLessThan(farGap);
    expect(nearGap).toBeLessThan(2);
  });

  it("survives a null-velocity, no-patch state without throwing", () => {
    render(<CrossSection verticalSpeed={null} horizontalSpeed={null} />);
    expect(
      screen.getByRole("img", { name: /descent .*ground speed/i }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <CrossSection
        patch={patch}
        patchSize={4}
        bearingDeg={90}
        verticalSpeed={40}
        horizontalSpeed={15}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
