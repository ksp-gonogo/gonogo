import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { deriveHazardVerdict } from "./hazardVerdict";
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
    const verdict = deriveHazardVerdict({ slopeDeg: 8, biome: "Highlands" });
    render(<TouchdownReticle {...base} verdict={verdict} />);
    const img = screen.getByRole("img", { name: /touchdown site/i });
    expect(img.getAttribute("aria-label")).toMatch(/8\.0° slope/);
    expect(img.getAttribute("aria-label")).toMatch(/downrange/);
    expect(img.getAttribute("aria-label")).toMatch(/predicted/);
  });

  // The verdict banner + biome/source readout are now composed by the widget
  // (below the plots) so the reticle stays a bare square that aligns with the
  // cross-section; the source still rides the reticle's accessible label.
  it("labels a sub-vessel fallback honestly as an estimate (in the label)", () => {
    const verdict = deriveHazardVerdict({ slopeDeg: 3 });
    render(
      <TouchdownReticle
        {...base}
        sampleSource="sub-vessel"
        verdict={verdict}
      />,
    );
    const img = screen.getByRole("img", { name: /touchdown site/i });
    expect(img.getAttribute("aria-label")).toMatch(/sub-vessel \(est\.\)/i);
  });

  it("renders relief cells when a terrain patch is present, and stays a labelled image", () => {
    const verdict = deriveHazardVerdict({ slopeDeg: 8 });
    // A 4x4 patch with a clear high/low split so the hillshade produces cells.
    const patch = [0, 1, 4, 9, 1, 2, 5, 10, 4, 5, 8, 13, 9, 10, 13, 18];
    const { container } = render(
      <TouchdownReticle
        {...base}
        verdict={verdict}
        terrainPatch={patch}
        terrainPatchSize={4}
      />,
    );
    // The relief adds shaded <rect> cells; the reticle is still one labelled img.
    expect(
      screen.getByRole("img", { name: /touchdown site/i }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(1);
  });

  it("has no axe violations", async () => {
    const verdict = deriveHazardVerdict({ slopeDeg: 8, biome: "Highlands" });
    const { container } = render(
      <TouchdownReticle {...base} verdict={verdict} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
