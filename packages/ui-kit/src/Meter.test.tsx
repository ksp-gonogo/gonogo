import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Meter } from "./Meter";
import { NULL_DISPLAY } from "./NullValue";

describe("Meter", () => {
  it("renders the accessible meter role with the given label and value", () => {
    render(<Meter label="LiquidFuel" value={0.5} />);
    const meter = screen.getByRole("meter", { name: "LiquidFuel" });
    expect(meter).toHaveAttribute("aria-valuenow", "50");
  });

  it("existing tone callers are unaffected: no fillColor falls back to the tone palette", () => {
    render(<Meter label="Dose" value={0.5} tone="warn" />);
    const meter = screen.getByRole("meter", { name: "Dose" });
    const fill = meter.firstElementChild as HTMLElement;
    expect(fill).toHaveStyle({ background: "var(--color-status-warning-bg)" });
  });

  it("fillColor wins over tone for the fill colour", () => {
    render(
      <Meter
        label="LiquidFuel"
        value={0.5}
        tone="go"
        fillColor="hsl(40deg 65% 55%)"
      />,
    );
    const meter = screen.getByRole("meter", { name: "LiquidFuel" });
    const fill = meter.firstElementChild as HTMLElement;
    expect(fill).toHaveStyle({ background: "hsl(40deg 65% 55%)" });
  });

  it("defaults to the neutral tone fill when neither tone nor fillColor is set", () => {
    render(<Meter label="Plain" value={0.5} />);
    const meter = screen.getByRole("meter", { name: "Plain" });
    const fill = meter.firstElementChild as HTMLElement;
    expect(fill).toHaveStyle({ background: "var(--color-text-muted)" });
  });

  it("renders an absent reading as absence, not as a zeroed bar", () => {
    render(<Meter label="Comfort" value={null} />);
    // No role="meter": a meter asserts a fill fraction, and there is none
    expect(screen.queryByRole("meter", { name: "Comfort" })).toBeNull();
    expect(screen.getByText("Comfort")).toBeInTheDocument();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("keeps a genuine zero as a meter, distinct from an absent one", () => {
    render(<Meter label="Comfort" value={0} />);
    const meter = screen.getByRole("meter", { name: "Comfort" });
    expect(meter).toHaveAttribute("aria-valuenow", "0");
  });
});

describe("Meter, given the quantity pair", () => {
  const tank = (amount: number, capacity: number) => ({
    amount: value("units", amount),
    capacity: value("units", capacity),
  });

  it("derives the fill fraction itself, so no call site divides", () => {
    render(<Meter label="LiquidFuel" quantity={tank(3, 4)} />);
    expect(screen.getByRole("meter", { name: "LiquidFuel" })).toHaveAttribute(
      "aria-valuenow",
      "75",
    );
  });

  it("writes both halves itself, rather than taking a formatted string", () => {
    const { container } = render(
      <Meter label="LiquidFuel" quantity={tank(3, 4)} />,
    );
    expect(container.textContent).toContain("3");
    expect(container.textContent).toContain("4");
  });

  it("divides across rungs of one kind, not across raw magnitudes", () => {
    // 500 W of a 1 kW budget is half, and nothing at the call site had to
    // know that a kilowatt is a thousand watts.
    render(
      <Meter
        label="Power"
        quantity={{ amount: value("W", 500), capacity: value("kW", 1) }}
      />,
    );
    expect(screen.getByRole("meter", { name: "Power" })).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
  });

  it("speaks both halves, with their unit's word rather than its symbol", () => {
    render(
      <Meter
        label="Power"
        quantity={{ amount: value("kW", 3), capacity: value("kW", 4) }}
      />,
    );
    const spoken = screen
      .getByRole("meter", { name: "Power" })
      .getAttribute("aria-valuetext");
    expect(spoken).toContain("kilowatt");
    expect(spoken).toContain("of");
  });

  it("renders no tank at all as absence, not as an empty one", () => {
    // A zero capacity is not a full tank and not an empty one; it is no tank.
    render(<Meter label="LiquidFuel" quantity={tank(0, 0)} />);
    expect(screen.queryByRole("meter", { name: "LiquidFuel" })).toBeNull();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("renders a null pair as absence, exactly as a null fraction does", () => {
    render(<Meter label="LiquidFuel" quantity={null} />);
    expect(screen.queryByRole("meter", { name: "LiquidFuel" })).toBeNull();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("still lets a caller's own sentence win, for both eye and ear", () => {
    render(
      <Meter
        label="LiquidFuel"
        quantity={tank(3, 4)}
        valueLabel="almost full"
      />,
    );
    expect(screen.getByRole("meter", { name: "LiquidFuel" })).toHaveAttribute(
      "aria-valuetext",
      "almost full",
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Meter label="LiquidFuel" quantity={tank(3, 4)} />,
    );
    await expectNoA11yViolations(container);
  });
});
