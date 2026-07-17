import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { BigReadout, Readout, ReadoutCaption, StatusPill } from "./Readout";

describe("Readout family", () => {
  it("BigReadout renders its value", () => {
    render(<BigReadout>1,204 m/s</BigReadout>);
    expect(screen.getByText("1,204 m/s")).toBeInTheDocument();
  });

  it("Readout applies a different class per tone", () => {
    const { rerender } = render(<Readout $tone="go">GO</Readout>);
    const goClass = screen.getByText("GO").className;
    rerender(<Readout $tone="alert">GO</Readout>);
    expect(screen.getByText("GO").className).not.toBe(goClass);
  });

  it("ReadoutCaption renders a sub-label", () => {
    render(<ReadoutCaption>ΔV remaining</ReadoutCaption>);
    expect(screen.getByText("ΔV remaining")).toBeInTheDocument();
  });

  it("StatusPill renders its token text", () => {
    render(<StatusPill $tone="alert">ABORT</StatusPill>);
    expect(screen.getByText("ABORT")).toBeInTheDocument();
  });
});
