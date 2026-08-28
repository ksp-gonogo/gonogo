import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Band } from "./Band";
import { NULL_DISPLAY } from "./NullValue";

describe("Band", () => {
  /**
   * The failure this widens digits for: both ends land on the megametre rung,
   * a length's default single decimal prints each as `6.7 Mm`, and an interval
   * renders as a scalar exactly where its width was the point.
   */
  it("widens the digits until the two ends read differently", () => {
    const { container } = render(
      <Band min={value("m", 6_700_000)} max={value("m", 6_710_000)} />,
    );
    expect(container.textContent).toContain("6.70");
    expect(container.textContent).toContain("6.71");
    expect(container.textContent).toContain("Mm");
  });

  it("leaves the kind's own precision alone when the ends already differ", () => {
    const { container } = render(
      <Band min={value("m", 1200)} max={value("m", 8400)} />,
    );
    expect(container.textContent).toContain("1.2");
    expect(container.textContent).toContain("8.4");
  });

  /**
   * An element that did not move over the window should print as one figure
   * twice, not as six decimals of noise nobody can read.
   */
  it("does not widen a band of zero width", () => {
    const { container } = render(
      <Band min={value("m", 6_700_000)} max={value("m", 6_700_000)} />,
    );
    expect(container.textContent).not.toContain("6.7000");
  });

  /**
   * One end alone reads as a scalar, and a scalar is the one thing an operator
   * must not take away from an interval whose other end could not be read.
   */
  it("shows a half-read band as absent rather than as a number", () => {
    const { container } = render(<Band min={value("m", 100)} max={null} />);
    expect(container.textContent).toBe(NULL_DISPLAY);
  });

  it("shows nothing at all as absent", () => {
    const { container } = render(<Band />);
    expect(container.textContent).toBe(NULL_DISPLAY);
  });

  /**
   * A circular quantity spanning half the turn or more has no interval left:
   * every value is inside it, and `0° – 359°` states the opposite of what is
   * true. The renderer decides this, not the caller, because three different
   * formatters would otherwise each have to know the rule.
   */
  it("says a modular quantity precessed instead of printing a full turn", () => {
    render(<Band min={value("°", 0)} max={value("°", 359)} wrapsAt={360} />);
    expect(screen.getByText("(precesses)")).toBeInTheDocument();
  });

  it("keeps a narrow modular band as an interval", () => {
    const { container } = render(
      <Band min={value("°", 44)} max={value("°", 46)} wrapsAt={360} />,
    );
    expect(container.textContent).not.toContain("precesses");
    expect(container.textContent).toContain("44");
    expect(container.textContent).toContain("46");
  });
});
