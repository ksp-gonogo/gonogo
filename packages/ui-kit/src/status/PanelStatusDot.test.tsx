import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { PanelStatusDot } from "./PanelStatusDot";

/**
 * The per-severity status dot for a Panel's collapsed header. Built fresh on the
 * canonical `Severity` + `severityDotColor` (the rebuild of the killed 3-tone
 * Dot draft). These assert the relationships and the accessible name, not the
 * pixels or the exact colour token (that is the visual gate's job).
 */
describe("PanelStatusDot", () => {
  it("renders a severity dot with an accessible name and no number for a single contributor", () => {
    render(<PanelStatusDot severity="warning" count={1} />);
    const dot = screen.getByRole("img", { name: "warning" });
    expect(dot).toHaveAttribute("data-severity", "warning");
    // A single contributor is just the coloured dot: no number inside.
    expect(dot).toHaveTextContent("");
  });

  it("shows the count INSIDE the dot when more than one, and in the accessible name", () => {
    render(<PanelStatusDot severity="caution" count={3} />);
    const dot = screen.getByRole("img", { name: "3 caution" });
    expect(dot).toHaveTextContent("3");
  });

  it("defaults the count to 1 (no number)", () => {
    render(<PanelStatusDot severity="critical" />);
    const dot = screen.getByRole("img", { name: "critical" });
    expect(dot).toHaveTextContent("");
    expect(dot).toHaveAttribute("data-severity", "critical");
  });
});
