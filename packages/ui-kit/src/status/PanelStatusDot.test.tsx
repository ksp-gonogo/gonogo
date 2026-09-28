import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { emittedRuleFor } from "../test/emittedRule";
import { PanelStatusDot } from "./PanelStatusDot";

// Asserts the relationships and the accessible name; pixels and colour tokens are the visual gate's job.
describe("PanelStatusDot", () => {
  it("renders a severity dot with an accessible name and no number for a single contributor", () => {
    render(<PanelStatusDot severity="warn" count={1} />);
    const dot = screen.getByRole("img", { name: "warning" });
    expect(dot).toHaveAttribute("data-severity", "warn");
    // A single contributor is just the coloured dot: no number inside.
    expect(dot).toHaveTextContent("");
  });

  it("shows the count INSIDE the dot when more than one, and in the accessible name", () => {
    render(<PanelStatusDot severity="caution" count={3} />);
    const dot = screen.getByRole("img", { name: "3 caution" });
    expect(dot).toHaveTextContent("3");
  });

  it("defaults the count to 1 (no number)", () => {
    render(<PanelStatusDot severity="nogo" />);
    const dot = screen.getByRole("img", { name: "critical" });
    expect(dot).toHaveTextContent("");
    expect(dot).toHaveAttribute("data-severity", "nogo");
  });

  it("grows into a pill sized to its digits when the count takes two", () => {
    render(<PanelStatusDot severity="warn" count={12} />);
    const rule = emittedRuleFor(
      screen.getByRole("img", { name: "12 warning" }),
    );
    expect(rule).toContain("width:calc(2ch + 4px)");
    expect(rule).toContain("border-radius:var(--radius-pill)");
  });

  it("stays the round dot for a single digit", () => {
    render(<PanelStatusDot severity="warn" count={9} />);
    const rule = emittedRuleFor(screen.getByRole("img", { name: "9 warning" }));
    expect(rule).toContain("width:8px");
    expect(rule).toContain("border-radius:var(--radius-circle)");
  });

  it("has no axe violations with and without a count", async () => {
    const { container } = render(
      <>
        <PanelStatusDot severity="warn" />
        <PanelStatusDot severity="nogo" count={12} />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
