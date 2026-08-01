import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Unit } from "./Unit";

/**
 * The point of this component is that it adapts to its surroundings rather than
 * taking props, so the tests are about what it inherits and what it refuses to
 * inherit.
 */
describe("Unit", () => {
  it("sizes relative to the text it sits in, with a floor", () => {
    // jsdom's CSS engine drops `max()` outright, so a computed-style assertion
    // here reads back the PARENT's 32px and proves nothing. Assert the emitted
    // rule instead: weaker, but it genuinely fails if the relative sizing or
    // its floor is removed, which is what this test is for.
    render(
      <span style={{ fontSize: "32px" }}>
        12.4 <Unit data-testid="big">km</Unit>
      </span>,
    );
    const css = Array.from(document.querySelectorAll("style"))
      .map((el) => el.textContent ?? "")
      .join("");
    expect(css).toContain("0.72em");
    expect(css).toContain("10px");
  });

  it("dims by opacity, not by a colour token, so it keeps the value's tone", () => {
    // A fixed grey symbol beside a red alert value reads as two things rather
    // than one quantity. Opacity dims whatever colour it inherits, so the
    // component must set no colour of its own.
    render(<Unit data-testid="u">m/s</Unit>);
    expect(getComputedStyle(screen.getByTestId("u")).opacity).toBe("0.72");
    const css = Array.from(document.querySelectorAll("style"))
      .map((el) => el.textContent ?? "")
      .join("");
    expect(css).not.toContain("--color-text-muted");
  });

  it("resists a parent that uppercases", () => {
    // m and M are metre and mega. PanelTitle's text-transform already turned a
    // unit into the wrong quantity once.
    render(
      <span style={{ textTransform: "uppercase" }}>
        <Unit data-testid="u">m</Unit>
      </span>,
    );
    expect(getComputedStyle(screen.getByTestId("u")).textTransform).toBe(
      "none",
    );
  });

  it("keeps the symbol whole and attached to its number", () => {
    render(<Unit data-testid="u">kg/m³</Unit>);
    const style = getComputedStyle(screen.getByTestId("u"));
    expect(style.whiteSpace).toBe("nowrap");
    // A margin rather than a space character, so a line break cannot separate
    // the symbol from the value it belongs to.
    expect(style.marginInlineStart).toBe("0.25em");
  });

  it("stays announceable rather than hidden", () => {
    // A symbol nobody announces is worse than one announced awkwardly. The
    // enclosing readout adds a spoken aria-label where it matters.
    render(<Unit>km</Unit>);
    expect(screen.getByText("km")).not.toHaveAttribute("aria-hidden");
  });
});
