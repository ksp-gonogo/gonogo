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
        12.4 <Unit>km</Unit>
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
    render(<Unit>m/s</Unit>);
    expect(getComputedStyle(screen.getByText("m/s")).opacity).toBe("0.72");
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
        <Unit>m</Unit>
      </span>,
    );
    expect(getComputedStyle(screen.getByText("m")).textTransform).toBe("none");
  });

  it("keeps the symbol whole and attached to its number", () => {
    render(<Unit>kg/m³</Unit>);
    const style = getComputedStyle(screen.getByText("kg/m³"));
    expect(style.whiteSpace).toBe("nowrap");
    // A margin rather than a space character, so a line break cannot separate
    // the symbol from the value it belongs to.
    expect(style.marginInlineStart).toBe("0.25em");
  });

  it("writes a plane angle hard against its number, at full size", () => {
    // SI leaves a space between number and unit, with one class of exception:
    // the plane-angle symbols. "22°", never "22 °". And a degree sign sits at
    // cap height, so shrinking it drops it toward the middle of the number
    // beside it, which is what a blanket shrink looked like.
    render(<Unit>{"\u00B0"}</Unit>);
    const style = getComputedStyle(screen.getByText("\u00B0"));
    expect(style.marginInlineStart).toBe("0px");
    expect(style.fontSize).toBe("1em");
    // Nor dimmed. A plane angle is part of the number's own typography, not a
    // unit token beside it, so dimming detaches it from the value it belongs to.
    expect(style.opacity).toBe("1");
  });

  it("does NOT attach degrees Celsius, which takes the normal space", () => {
    // The exception is plane angle only. Celsius is a temperature and spaces
    // like any other unit, which is the distinction most implementations miss.
    render(<Unit>°C</Unit>);
    const style = getComputedStyle(screen.getByText("°C"));
    expect(style.marginInlineStart).toBe("0.25em");
  });

  it("stays announceable rather than hidden", () => {
    // A symbol nobody announces is worse than one announced awkwardly. The
    // enclosing readout adds a spoken aria-label where it matters.
    render(<Unit>km</Unit>);
    expect(screen.getByText("km")).not.toHaveAttribute("aria-hidden");
  });
});
