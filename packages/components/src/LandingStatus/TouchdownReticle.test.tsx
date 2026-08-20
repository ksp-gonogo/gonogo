import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { TouchdownReticle } from "./TouchdownReticle";

const base = {
  siteLat: 0.5,
  siteLon: 0.5,
  vesselLat: 0,
  vesselLon: 0,
  bodyRadius: 600_000,
  slopeDeg: 8,
  biome: "Highlands",
  sampleSource: "predicted" as const,
};

describe("TouchdownReticle", () => {
  it("renders the site as an image with slope, downrange, biome + source in the label", () => {
    render(<TouchdownReticle {...base} />);
    const img = screen.getByRole("img", { name: /touchdown site/i });
    expect(img.getAttribute("aria-label")).toMatch(/8\.0° slope/);
    expect(img.getAttribute("aria-label")).toMatch(/downrange/);
    expect(img.getAttribute("aria-label")).toMatch(/predicted/);
  });

  it("draws the landing-zone ring when a zone radius is given (dashed area, not a pinpoint)", () => {
    const { container } = render(
      <TouchdownReticle {...base} spanMeters={800} zoneRadiusMeters={200} />,
    );
    // A dashed circle centred on the site (160-box centre = 80,80).
    const ring = container.querySelector("circle[stroke-dasharray]");
    expect(ring).not.toBeNull();
    expect(ring?.getAttribute("cx")).toBe("80");
    expect(ring?.getAttribute("cy")).toBe("80");
    // 200 m at an 800 m span over the (C-18)=62 px radius → ~15.5 px.
    expect(Number(ring?.getAttribute("r"))).toBeCloseTo(15.5, 0);
  });

  it("omits the zone ring when no radius is provided", () => {
    const { container } = render(<TouchdownReticle {...base} />);
    expect(container.querySelector("circle[stroke-dasharray]")).toBeNull();
  });

  // The verdict banner + biome/source readout are now composed by the widget
  // (below the plots) so the reticle stays a bare square that aligns with the
  // cross-section; the source still rides the reticle's accessible label.
  it("labels a sub-vessel fallback honestly as an estimate (in the label)", () => {
    render(<TouchdownReticle {...base} sampleSource="sub-vessel" />);
    const img = screen.getByRole("img", { name: /touchdown site/i });
    expect(img.getAttribute("aria-label")).toMatch(/sub-vessel \(est\.\)/i);
  });

  it("renders relief cells when a terrain patch is present, and stays a labelled image", () => {
    // A 4x4 patch with a clear high/low split so the hillshade produces cells.
    const patch = [0, 1, 4, 9, 1, 2, 5, 10, 4, 5, 8, 13, 9, 10, 13, 18];
    const { container } = render(
      <TouchdownReticle {...base} terrainPatch={patch} terrainPatchSize={4} />,
    );
    // The relief adds shaded <rect> cells; the reticle is still one labelled img.
    expect(
      screen.getByRole("img", { name: /touchdown site/i }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(<TouchdownReticle {...base} />);
    await expectNoA11yViolations(container);
  });
});
