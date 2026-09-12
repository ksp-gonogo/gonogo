import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Tape } from "./Tape";

/** An altitude, the strip's canonical subject. */
const m = (n: number) => value("m", n);

describe("Tape", () => {
  it("exposes meter semantics with the current value and range", () => {
    render(
      <Tape value={m(1200)} min={m(0)} max={m(5000)} ariaLabel="Altitude" />,
    );
    const meter = screen.getByRole("meter", { name: "Altitude" });
    expect(meter).toHaveAttribute("aria-valuenow", "1200");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "5000");
  });

  it("clamps aria-valuenow into range but reports the true value in valuetext", () => {
    render(<Tape value={m(9000)} min={m(0)} max={m(5000)} ariaLabel="Alt" />);
    const meter = screen.getByRole("meter", { name: "Alt" });
    expect(meter).toHaveAttribute("aria-valuenow", "5000");
    // Spoken, not written: the strip announces the unit's word, never "m".
    expect(meter.getAttribute("aria-valuetext")).toContain("kilometre");
  });

  it("holds one rung for the whole scale, taken from the top of it", () => {
    // Every mark on a 5 km strip reads in km, including the 200 m marker that
    // would ladder down to metres on its own magnitude. A ruler whose marks
    // change unit partway up is not a ruler.
    const { container } = render(
      <Tape
        value={m(1200)}
        min={m(0)}
        max={m(5000)}
        tickStep={m(1000)}
        ariaLabel="Alt"
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("km");
    expect(text).not.toContain(" m");
  });

  it("treats a non-finite value as the minimum", () => {
    render(
      <Tape value={m(Number.NaN)} min={m(0)} max={m(5000)} ariaLabel="Alt" />,
    );
    expect(screen.getByRole("meter", { name: "Alt" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("renders zone and marker labels as text equivalents", () => {
    render(
      <Tape
        value={m(800)}
        min={m(0)}
        max={m(5000)}
        ariaLabel="Alt"
        zones={[{ from: m(500), to: m(1500), label: "ignition" }]}
        markers={[{ value: m(200), label: "gear" }]}
      />,
    );
    expect(screen.getByText("ignition")).toBeInTheDocument();
    expect(screen.getByText("gear")).toBeInTheDocument();
  });

  it("renders a safe empty meter when the range is degenerate", () => {
    render(<Tape value={m(5)} min={m(10)} max={m(10)} ariaLabel="Alt" />);
    // Degenerate range collapses to valuemin===valuemax; still a valid node.
    expect(screen.getByRole("meter", { name: "Alt" })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Tape
        value={m(1200)}
        min={m(0)}
        max={m(5000)}
        tickStep={m(1000)}
        groundLine={m(0)}
        ariaLabel="Altitude above terrain"
      />,
    );
    await expectNoA11yViolations(container);
  });
});
