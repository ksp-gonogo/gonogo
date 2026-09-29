import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Slider } from "./Slider";
import { emittedStateRuleFor } from "./test/emittedRule";

describe("Slider", () => {
  it("is a range input, whatever type a caller might pass", () => {
    render(<Slider aria-label="Throttle" min={0} max={1} step={0.01} />);
    expect(screen.getByRole("slider", { name: "Throttle" })).toHaveAttribute(
      "type",
      "range",
    );
  });

  it("draws the kit focus ring and has no axe violations", async () => {
    const { container } = render(<Slider aria-label="Gain" />);
    expect(
      emittedStateRuleFor(
        screen.getByRole("slider", { name: "Gain" }),
        ":focus-visible",
      ),
    ).toContain("outline:2px solid var(--color-focus)");
    await expectNoA11yViolations(container);
  });
});
