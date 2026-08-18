import { describe, expect, it } from "vitest";
import { Dial } from "./Dial";
import { render, screen } from "./testing-react";

describe("Dial", () => {
  it("exposes meter semantics with the current value and range", () => {
    render(<Dial value={45} min={0} max={360} unit="°" ariaLabel="Heading" />);
    const meter = screen.getByRole("meter", { name: "Heading" });
    expect(meter).toHaveAttribute("aria-valuenow", "45");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "360");
  });

  it("wraps a compass value into range when wrap is set", () => {
    render(
      <Dial value={370} min={0} max={360} wrap unit="°" ariaLabel="Heading" />,
    );
    // 370° wraps to 10° on a 0–360 compass.
    expect(screen.getByRole("meter", { name: "Heading" })).toHaveAttribute(
      "aria-valuenow",
      "10",
    );
  });

  it("clamps a non-wrapping value into range", () => {
    render(<Dial value={500} min={0} max={100} ariaLabel="Throttle" />);
    expect(screen.getByRole("meter", { name: "Throttle" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("treats a non-finite value as the minimum", () => {
    render(<Dial value={Number.NaN} min={0} max={100} ariaLabel="X" />);
    expect(screen.getByRole("meter", { name: "X" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("renders a safe empty meter when the range is degenerate", () => {
    render(<Dial value={5} min={10} max={10} ariaLabel="X" />);
    expect(screen.getByRole("meter", { name: "X" })).toBeInTheDocument();
  });
});
