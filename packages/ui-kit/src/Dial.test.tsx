import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Dial } from "./Dial";

/** A compass bearing, the dial's canonical subject. */
const deg = (n: number) => value("°", n);
/** A bounded percentage, for the non-wrapping cases. */
const pct = (n: number) => value("%", n);

describe("Dial", () => {
  it("exposes meter semantics with the current value and range", () => {
    render(
      <Dial value={deg(45)} min={deg(0)} max={deg(360)} ariaLabel="Heading" />,
    );
    const meter = screen.getByRole("meter", { name: "Heading" });
    expect(meter).toHaveAttribute("aria-valuenow", "45");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "360");
  });

  it("speaks the value with its unit, rather than announcing a bare number", () => {
    render(
      <Dial value={deg(45)} min={deg(0)} max={deg(360)} ariaLabel="Heading" />,
    );
    expect(
      screen
        .getByRole("meter", { name: "Heading" })
        .getAttribute("aria-valuetext"),
    ).toContain("degree");
  });

  it("writes the degree sign hard against the number, as SI requires", () => {
    // No space before the sign, and the precision is the angle kind's own
    // rather than anything this component chose.
    const { container } = render(
      <Dial value={deg(45)} min={deg(0)} max={deg(360)} ariaLabel="Heading" />,
    );
    expect(container.textContent).toContain("45.00°");
    expect(container.textContent).not.toContain(" °");
  });

  it("wraps a compass value into range when wrap is set", () => {
    render(
      <Dial
        value={deg(370)}
        min={deg(0)}
        max={deg(360)}
        wrap
        ariaLabel="Heading"
      />,
    );
    // 370° wraps to 10° on a 0–360 compass.
    expect(screen.getByRole("meter", { name: "Heading" })).toHaveAttribute(
      "aria-valuenow",
      "10",
    );
  });

  it("clamps a non-wrapping value into range", () => {
    render(
      <Dial
        value={pct(500)}
        min={pct(0)}
        max={pct(100)}
        ariaLabel="Throttle"
      />,
    );
    expect(screen.getByRole("meter", { name: "Throttle" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("treats a non-finite value as the minimum", () => {
    render(
      <Dial
        value={pct(Number.NaN)}
        min={pct(0)}
        max={pct(100)}
        ariaLabel="X"
      />,
    );
    expect(screen.getByRole("meter", { name: "X" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("renders a safe empty meter when the range is degenerate", () => {
    render(<Dial value={pct(5)} min={pct(10)} max={pct(10)} ariaLabel="X" />);
    expect(screen.getByRole("meter", { name: "X" })).toBeInTheDocument();
  });

  it("has no axe violations (compass with zones and ticks)", async () => {
    const { container } = render(
      <Dial
        value={deg(135)}
        min={deg(0)}
        max={deg(360)}
        wrap
        ticks={[
          { value: deg(0), label: "N" },
          { value: deg(180), label: "S" },
        ]}
        zones={[{ from: deg(60), to: deg(120), color: "red" }]}
        ariaLabel="Slope fall direction"
      />,
    );
    await expectNoA11yViolations(container);
  });
});
