import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Readout, ReadoutCaption } from "./Readout";

describe("Readout family", () => {
  it("a hero Readout renders its value and fills the space it is given", () => {
    render(<Readout size="hero">1,204 m/s</Readout>);
    const el = screen.getByText("1,204 m/s");
    expect(el).toBeInTheDocument();
    expect(getComputedStyle(el).flexDirection).toBe("column");
  });

  it("a Readout is inline by default", () => {
    render(<Readout>1,204 m/s</Readout>);
    expect(getComputedStyle(screen.getByText("1,204 m/s")).display).toBe(
      "inline-flex",
    );
  });

  it("Readout applies a different class per tone", () => {
    const { rerender } = render(<Readout tone="go">GO</Readout>);
    const goClass = screen.getByText("GO").className;
    rerender(<Readout tone="nogo">GO</Readout>);
    expect(screen.getByText("GO").className).not.toBe(goClass);
  });

  it("ReadoutCaption renders a sub-label", () => {
    render(<ReadoutCaption>ΔV remaining</ReadoutCaption>);
    expect(screen.getByText("ΔV remaining")).toBeInTheDocument();
  });
});
