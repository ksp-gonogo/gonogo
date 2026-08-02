import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Unit } from "./Unit";

/**
 * Two things are being tested here. The component adapts to its surroundings
 * rather than taking props, so half the tests are about what it inherits and
 * what it refuses to inherit. The other half are about what it RESOLVES: it is
 * handed a unit token and looks up the display form, the icon and the spoken
 * word from the model, which is what stops a second component like the old
 * `CurrencyUnit` from existing.
 *
 * Style assertions target `[data-unit]` rather than the symbol's own text,
 * because the symbol now sits in a nested `aria-hidden` span whenever there is
 * a word to say instead of it.
 */
function unitEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-unit]");
  if (!el) throw new Error("no unit rendered");
  return el;
}

describe("Unit: presentation", () => {
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
    const { container } = render(<Unit>m/s</Unit>);
    expect(getComputedStyle(unitEl(container)).opacity).toBe("0.72");
    const css = Array.from(document.querySelectorAll("style"))
      .map((el) => el.textContent ?? "")
      .join("");
    expect(css).not.toContain("--color-text-muted");
  });

  it("resists a parent that uppercases", () => {
    // m and M are metre and mega. PanelTitle's text-transform already turned a
    // unit into the wrong quantity once.
    const { container } = render(
      <span style={{ textTransform: "uppercase" }}>
        <Unit>m</Unit>
      </span>,
    );
    expect(getComputedStyle(unitEl(container)).textTransform).toBe("none");
  });

  it("keeps the symbol whole and attached to its number", () => {
    const { container } = render(<Unit>kg/m³</Unit>);
    const style = getComputedStyle(unitEl(container));
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
    const { container } = render(<Unit>{"°"}</Unit>);
    const style = getComputedStyle(unitEl(container));
    expect(style.marginInlineStart).toBe("0px");
    expect(style.fontSize).toBe("1em");
    // Nor dimmed. A plane angle is part of the number's own typography, not a
    // unit token beside it, so dimming detaches it from the value it belongs to.
    expect(style.opacity).toBe("1");
  });

  it("does NOT attach degrees Celsius, which takes the normal space", () => {
    // The exception is plane angle only. Celsius is a temperature and spaces
    // like any other unit, which is the distinction most implementations miss.
    const { container } = render(<Unit>°C</Unit>);
    expect(getComputedStyle(unitEl(container)).marginInlineStart).toBe(
      "0.25em",
    );
  });
});

describe("Unit: what it resolves from the model", () => {
  it("shows the kind's display form, not the token", () => {
    // `funds` is a kind whose display symbol is `f`. The call site names the
    // unit; the model decides what that looks like. This is what removed the
    // separate currency component: it was holding presentation for three kinds
    // the model already carried.
    const { container } = render(<Unit>funds</Unit>);
    expect(unitEl(container).textContent).toBe("f funds");
  });

  it("renders an icon where the model has one, and still says the word", () => {
    // Science and reputation are glyphs. lucide marks its svg aria-hidden and
    // so does this package's icon wrapper, so without the word an icon unit
    // announces a bare number.
    const { container } = render(<Unit>science</Unit>);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(unitEl(container).textContent).toBe(" science");
  });

  it("says the word INSTEAD of the symbol, not as well as it", () => {
    // Announcing both reads as "kay em kilometres", and the currencies were
    // worse: "twelve thousand four hundred and fifty f funds".
    render(<Unit>km</Unit>);
    expect(screen.getByText("km")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("kilometres")).toBeInTheDocument();
  });

  it("says a word for a symbol that announces as nothing at all", () => {
    // The degree sign is silent to a screen reader, so a degrees readout
    // announces a bare number. This is the case where the word is not a
    // nicety: without it the unit is simply absent.
    const { container } = render(<Unit>{"°"}</Unit>);
    expect(unitEl(container).textContent).toBe("° degrees");
  });

  it("keeps an unknown symbol announceable rather than silent", () => {
    // No word means no aria-hidden. An awkward "kyoo zed" beats the unit
    // vanishing, and it is the signal that the word table is missing an entry
    // rather than that the unit cannot be spoken.
    render(<Unit>qz</Unit>);
    expect(screen.getByText("qz")).not.toHaveAttribute("aria-hidden");
  });

  it("renders nothing for a kind that names a category", () => {
    // `count`, `id`, `text`, `flag`, `enum` and `n/a` say what a field IS
    // rather than what it is measured in. "3 count" is not a readout, so there
    // is no symbol to show and nothing to announce.
    const { container } = render(<Unit>count</Unit>);
    expect(container.querySelector("[data-unit]")).toBeNull();
  });
});
