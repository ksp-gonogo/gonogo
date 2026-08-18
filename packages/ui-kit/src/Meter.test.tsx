import { describe, expect, it } from "vitest";
import { Meter } from "./Meter";
import { render, screen } from "./testing-react";

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
});
