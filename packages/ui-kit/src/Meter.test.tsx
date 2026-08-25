import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
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
