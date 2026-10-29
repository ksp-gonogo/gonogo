import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  BellIcon,
  RotateAnticlockwiseIcon,
  RotateClockwiseIcon,
  SettingsIcon,
} from "./Icons";

describe("Icons", () => {
  it("is decorative and hidden when it has no label", () => {
    const { container } = render(<BellIcon />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("is an image named by its label when given one", () => {
    render(<SettingsIcon label="Settings" />);
    const img = screen.getByRole("img", { name: "Settings" });
    expect(img).not.toHaveAttribute("aria-hidden", "true");
  });

  it("writes a token size as CSS, never as an SVG attribute", () => {
    const { container } = render(
      <>
        <BellIcon />
        <BellIcon size={48} data-testid="big" />
      </>,
    );
    const [token] = container.querySelectorAll("svg");
    expect(token.getAttribute("width")).not.toContain("var(");
    expect(token).toHaveStyle({ width: "var(--icon-size-control)" });
    expect(screen.getByTestId("big")).toHaveAttribute("width", "48");
  });

  it("draws the two rotate arrows as different shapes", () => {
    const { container } = render(
      <>
        <RotateClockwiseIcon />
        <RotateAnticlockwiseIcon />
      </>,
    );
    const [cw, ccw] = Array.from(container.querySelectorAll("svg")).map(
      (svg) => svg.innerHTML,
    );
    expect(cw).not.toBe("");
    expect(cw).not.toBe(ccw);
  });

  it("has no axe violations named or decorative", async () => {
    const { container } = render(
      <>
        <BellIcon />
        <SettingsIcon label="Settings" />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
