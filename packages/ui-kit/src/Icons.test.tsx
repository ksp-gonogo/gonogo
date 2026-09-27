import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { BellIcon, SettingsIcon } from "./Icons";

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
