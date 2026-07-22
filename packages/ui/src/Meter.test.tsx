import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Meter } from "./Meter";
import { axe } from "./test/axe";

describe("Meter", () => {
  it("exposes meter semantics with the value as percentage", () => {
    render(<Meter label="Shielding" value={0.5} />);
    const meter = screen.getByRole("meter", { name: "Shielding" });
    expect(meter).toHaveAttribute("aria-valuenow", "50");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
  });

  it("clamps out-of-range and non-finite values", () => {
    const { rerender } = render(<Meter label="X" value={1.7} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
    rerender(<Meter label="X" value={-0.4} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
    rerender(<Meter label="X" value={Number.NaN} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  });

  it("defaults the displayed text and aria-valuetext to a percentage", () => {
    render(<Meter label="Shielding" value={0.5} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuetext", "50%");
  });

  it("rounds the percentage to the nearest whole number", () => {
    // 0.365 -> 36.5 -> 37; guards the Math.round in the pct derivation that
    // the shielding/resource fractions upstream rely on (e.g. 1.2 / 3.308).
    render(<Meter label="Dose" value={0.365} />);
    const meter = screen.getByRole("meter", { name: "Dose" });
    expect(meter).toHaveAttribute("aria-valuenow", "37");
    expect(screen.getByText("37%")).toBeInTheDocument();
  });

  it("shows a custom valueLabel as text and aria-valuetext", () => {
    render(<Meter label="Dose" value={0.2} valueLabel="5.0 rad/h" />);
    expect(screen.getByText("5.0 rad/h")).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute(
      "aria-valuetext",
      "5.0 rad/h",
    );
  });

  it("applies a different fill class per tone", () => {
    const { container, rerender } = render(
      <Meter label="A" value={0.5} tone="go" />,
    );
    const goFill = container.querySelector("[role=meter] > div")?.className;
    rerender(<Meter label="A" value={0.5} tone="nogo" />);
    const nogoFill = container.querySelector("[role=meter] > div")?.className;
    expect(goFill).not.toBe(nogoFill);
  });

  it("has no axe violations across tones", async () => {
    const { container } = render(
      <>
        <Meter label="Neutral" value={0.3} tone="neutral" />
        <Meter label="Go" value={0.9} tone="go" valueLabel="90%" />
        <Meter label="Warn" value={0.6} tone="warn" />
        <Meter label="Nogo" value={0.1} tone="nogo" />
        <Meter label="Info" value={0.5} tone="info" size="sm" />
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
