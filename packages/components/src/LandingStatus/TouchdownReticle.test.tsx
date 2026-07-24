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
  slopeHeadingDeg: 135,
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

  it("shows the hazard verdict in a polite live-region banner", () => {
    const verdict = deriveHazardVerdict({ slopeDeg: 20 }); // DIVERT (>15)
    render(<TouchdownReticle {...base} slopeDeg={20} verdict={verdict} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("DIVERT");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("labels a sub-vessel fallback honestly as an estimate", () => {
    const verdict = deriveHazardVerdict({ slopeDeg: 3 });
    render(
      <TouchdownReticle
        {...base}
        sampleSource="sub-vessel"
        verdict={verdict}
      />,
    );
    expect(screen.getAllByText(/sub-vessel \(est\.\)/i).length).toBeGreaterThan(
      0,
    );
  });

  it("has no axe violations", async () => {
    const verdict = deriveHazardVerdict({ slopeDeg: 8, biome: "Highlands" });
    const { container } = render(
      <TouchdownReticle {...base} verdict={verdict} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
