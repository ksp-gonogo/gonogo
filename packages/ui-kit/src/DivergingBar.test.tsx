import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { DivergingBar } from "./DivergingBar";

describe("DivergingBar", () => {
  it("is decorative: aria-hidden, no accessible role", () => {
    render(<DivergingBar value={4} maxAbs={4} />);
    const bar = screen.getByTestId("diverging-bar");
    expect(bar).toHaveAttribute("aria-hidden", "true");
  });

  it("puts the largest-magnitude value at exactly the track's half-width mark", () => {
    render(<DivergingBar value={4} maxAbs={4} />);
    const fill = screen.getByTestId("diverging-bar")
      .lastElementChild as HTMLElement;
    expect(fill.style.width).toBe("50%");
  });

  it("scales a smaller value proportionally, regardless of sign", () => {
    const { rerender } = render(<DivergingBar value={1} maxAbs={4} />);
    let fill = screen.getByTestId("diverging-bar")
      .lastElementChild as HTMLElement;
    expect(fill.style.width).toBe("12.5%");

    rerender(<DivergingBar value={-1} maxAbs={4} />);
    fill = screen.getByTestId("diverging-bar").lastElementChild as HTMLElement;
    expect(fill.style.width).toBe("12.5%");
  });

  it("fills rightward in the go tone for a non-negative value", () => {
    render(<DivergingBar value={2} maxAbs={4} />);
    const fill = screen.getByTestId("diverging-bar")
      .lastElementChild as HTMLElement;
    expect(fill).toHaveStyle({ left: "50%" });
    expect(fill).toHaveStyle({ background: "var(--color-status-go-bg)" });
  });

  it("fills leftward in the nogo tone for a negative value", () => {
    render(<DivergingBar value={-2} maxAbs={4} />);
    const fill = screen.getByTestId("diverging-bar")
      .lastElementChild as HTMLElement;
    expect(fill).toHaveStyle({ right: "50%" });
    expect(fill).toHaveStyle({ background: "var(--color-status-nogo-bg)" });
  });

  it("is empty when there is no scale to measure against", () => {
    render(<DivergingBar value={5} maxAbs={0} />);
    const fill = screen.getByTestId("diverging-bar")
      .lastElementChild as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });
});
