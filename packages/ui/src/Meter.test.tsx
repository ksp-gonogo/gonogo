import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Meter } from "./Meter";

describe("Meter", () => {
  it("exposes meter semantics with the value as percentage", () => {
    render(<Meter label="Shielding" value={value("ratio", 0.5)} />);
    const meter = screen.getByRole("meter", { name: "Shielding" });
    expect(meter).toHaveAttribute("aria-valuenow", "50");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
  });

  it("clamps out-of-range values and draws a non-finite one as absent", () => {
    const { rerender } = render(
      <Meter label="X" value={value("ratio", 1.7)} />,
    );
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
    rerender(<Meter label="X" value={value("ratio", -0.4)} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
    rerender(<Meter label="X" value={value("ratio", Number.NaN)} />);
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it("defaults the displayed text and aria-valuetext to a percentage", () => {
    render(<Meter label="Shielding" value={value("ratio", 0.5)} />);
    // Two forms on purpose. What a reader SEES goes through <Unit>, which puts
    // the number and its symbol in separate elements, so `visibleText` is what
    // reads it back. What a screen reader HEARS is a string in an attribute,
    // and says the unit as a word rather than as the percent sign.
    expect(visibleText()).toContain("50 %");
    expect(screen.getByRole("meter")).toHaveAttribute(
      "aria-valuetext",
      "50 percent",
    );
  });

  it("rounds the percentage to the nearest whole number", () => {
    // 0.365 -> 36.5 -> 37; guards the Math.round in the pct derivation that
    // the shielding/resource fractions upstream rely on (e.g. 1.2 / 3.308).
    render(<Meter label="Dose" value={value("ratio", 0.365)} />);
    const meter = screen.getByRole("meter", { name: "Dose" });
    expect(meter).toHaveAttribute("aria-valuenow", "37");
    expect(visibleText()).toContain("37 %");
  });

  it("shows a custom valueLabel as text and aria-valuetext", () => {
    render(
      <Meter label="Dose" value={value("ratio", 0.2)} valueLabel="5.0 rad/h" />,
    );
    expect(screen.getByText("5.0 rad/h")).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute(
      "aria-valuetext",
      "5.0 rad/h",
    );
  });

  it("applies a different fill class per tone", () => {
    const { container, rerender } = render(
      <Meter label="A" value={value("ratio", 0.5)} tone="go" />,
    );
    const goFill = container.querySelector("[role=meter] > div")?.className;
    rerender(<Meter label="A" value={value("ratio", 0.5)} tone="nogo" />);
    const nogoFill = container.querySelector("[role=meter] > div")?.className;
    expect(goFill).not.toBe(nogoFill);
  });

  it("has no axe violations across tones", async () => {
    const { container } = render(
      <>
        <Meter label="Neutral" value={value("ratio", 0.3)} tone="neutral" />
        <Meter
          label="Go"
          value={value("ratio", 0.9)}
          tone="go"
          valueLabel="90%"
        />
        <Meter label="Warn" value={value("ratio", 0.6)} tone="warn" />
        <Meter label="Nogo" value={value("ratio", 0.1)} tone="nogo" />
        <Meter label="Info" value={value("ratio", 0.5)} tone="info" />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
