import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { DivergingBar } from "./DivergingBar";

/** The bar's own kind: a signed rate, the shape it was built for. */
const rate = (perSecond: number) => value("units/s", perSecond);

describe("DivergingBar", () => {
  it("is decorative: aria-hidden, no accessible role", () => {
    render(<DivergingBar value={rate(4)} maxAbs={rate(4)} />);
    const bar = screen.getByTestId("diverging-bar");
    expect(bar).toHaveAttribute("aria-hidden", "true");
  });

  it("puts the largest-magnitude value at exactly the track's half-width mark", () => {
    render(<DivergingBar value={rate(4)} maxAbs={rate(4)} />);
    const fill = screen.getByTestId("diverging-bar")
      .lastElementChild as HTMLElement;
    expect(fill.style.width).toBe("50%");
  });

  it("scales a smaller value proportionally, regardless of sign", () => {
    const { rerender } = render(
      <DivergingBar value={rate(1)} maxAbs={rate(4)} />,
    );
    let fill = screen.getByTestId("diverging-bar")
      .lastElementChild as HTMLElement;
    expect(fill.style.width).toBe("12.5%");

    rerender(<DivergingBar value={rate(-1)} maxAbs={rate(4)} />);
    fill = screen.getByTestId("diverging-bar").lastElementChild as HTMLElement;
    expect(fill.style.width).toBe("12.5%");
  });

  it("fills rightward in the go tone for a non-negative value", () => {
    render(<DivergingBar value={rate(2)} maxAbs={rate(4)} />);
    const fill = screen.getByTestId("diverging-bar")
      .lastElementChild as HTMLElement;
    expect(fill).toHaveStyle({ left: "50%" });
    expect(fill).toHaveStyle({ background: "var(--color-status-go-bg)" });
  });

  it("fills leftward in the nogo tone for a negative value", () => {
    render(<DivergingBar value={rate(-2)} maxAbs={rate(4)} />);
    const fill = screen.getByTestId("diverging-bar")
      .lastElementChild as HTMLElement;
    expect(fill).toHaveStyle({ right: "50%" });
    expect(fill).toHaveStyle({ background: "var(--color-status-nogo-bg)" });
  });

  it("is empty when there is no scale to measure against", () => {
    render(<DivergingBar value={rate(5)} maxAbs={rate(0)} />);
    const fill = screen.getByTestId("diverging-bar")
      .lastElementChild as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  it("scales against a value expressed on another rung of its own kind", () => {
    // The comparison is dimensional, not textual: the scale arrives in
    // kilowatts and the term in watts, and the bar still reads half.
    render(<DivergingBar value={value("W", 500)} maxAbs={value("kW", 1)} />);
    const fill = screen.getByTestId("diverging-bar")
      .lastElementChild as HTMLElement;
    expect(fill.style.width).toBe("25%");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <DivergingBar value={rate(2)} maxAbs={rate(4)} />,
    );
    await expectNoA11yViolations(container);
  });
});
