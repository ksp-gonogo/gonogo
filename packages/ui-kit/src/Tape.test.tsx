import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Tape } from "./Tape";

describe("Tape", () => {
  it("exposes meter semantics with the current value and range", () => {
    render(
      <Tape value={1200} min={0} max={5000} unit="m" ariaLabel="Altitude" />,
    );
    const meter = screen.getByRole("meter", { name: "Altitude" });
    expect(meter).toHaveAttribute("aria-valuenow", "1200");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "5000");
  });

  it("clamps aria-valuenow into range but reports the true value in valuetext", () => {
    render(<Tape value={9000} min={0} max={5000} unit="m" ariaLabel="Alt" />);
    const meter = screen.getByRole("meter", { name: "Alt" });
    expect(meter).toHaveAttribute("aria-valuenow", "5000");
    expect(meter).toHaveAttribute("aria-valuetext", "9000 m");
  });

  it("treats a non-finite value as the minimum", () => {
    render(<Tape value={Number.NaN} min={0} max={5000} ariaLabel="Alt" />);
    expect(screen.getByRole("meter", { name: "Alt" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("renders zone and marker labels as text equivalents", () => {
    render(
      <Tape
        value={800}
        min={0}
        max={5000}
        ariaLabel="Alt"
        zones={[{ from: 500, to: 1500, label: "ignition" }]}
        markers={[{ value: 200, label: "gear" }]}
      />,
    );
    expect(screen.getByText("ignition")).toBeInTheDocument();
    expect(screen.getByText("gear")).toBeInTheDocument();
  });

  it("renders a safe empty meter when the range is degenerate", () => {
    render(<Tape value={5} min={10} max={10} ariaLabel="Alt" />);
    // Degenerate range collapses to valuemin===valuemax; still a valid node.
    expect(screen.getByRole("meter", { name: "Alt" })).toBeInTheDocument();
  });
});
