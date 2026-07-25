import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
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
    expect(await axe(container)).toHaveNoViolations();
  });
});
