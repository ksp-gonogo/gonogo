import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { NULL_DISPLAY } from "./NullValue";
import { visibleText } from "./testing";
import { render, screen } from "./testing-react";
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
    // "kg/m³" must never wrap mid-symbol.
    expect(style.whiteSpace).toBe("nowrap");
    // No margin. The gap is a real character now: see the copy-paste tests.
    expect(style.marginInlineStart).toBe("0");
  });

  it("separates a number from its unit with a real character", () => {
    // A margin is invisible to the clipboard, so copying a readout yielded
    // "12.4km". The thin space copies as the space a reader expects, and SI
    // asks for one anyway.
    const { container } = render(<Unit value={value("m", 12_400)} />);
    expect(container.textContent).toContain("\u2009");
  });

  it("does not leak the spoken word into a copied readout", () => {
    // The word lives in the accessibility tree so a screen reader says
    // "kilometres" rather than "kay em". It must not also land in the
    // clipboard, or copying gives "12.4 km kilometres".
    const { container } = render(<Unit value={value("m", 12_400)} />);
    const hidden = container.querySelector("[data-unit] span + span");
    expect(getComputedStyle(hidden as Element).userSelect).toBe("none");
  });

  it("keeps the number and its unit on one line", () => {
    // What the margin was standing in for. The thin space is breakable, so
    // the protection has to come from the wrapper instead.
    const { container } = render(<Unit value={value("m", 12_400)} />);
    expect(
      getComputedStyle(container.firstElementChild as Element).whiteSpace,
    ).toBe("nowrap");
  });

  it("writes a plane angle hard against its number, at full size", () => {
    // SI leaves a space between number and unit, with one class of exception:
    // the plane-angle symbols. "22°", never "22 °". And a degree sign sits at
    // cap height, so shrinking it drops it toward the middle of the number
    // beside it, which is what a blanket shrink looked like.
    const { container } = render(<Unit value={value("°", 22)} />);
    const style = getComputedStyle(unitEl(container));
    // No thin space before it, unlike every other unit.
    expect(container.textContent).not.toContain("\u2009");
    expect(style.fontSize).toBe("1em");
    // Nor dimmed. A plane angle is part of the number's own typography, not a
    // unit token beside it, so dimming detaches it from the value it belongs to.
    expect(style.opacity).toBe("1");
  });

  it("does NOT attach degrees Celsius, which takes the normal space", () => {
    // The exception is plane angle only. Celsius is a temperature and spaces
    // like any other unit, which is the distinction most implementations miss.
    const { container } = render(<Unit value={value("K", 300)} as="°C" />);
    expect(container.textContent).toContain("\u2009");
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

/**
 * The headline form. A value carries its own unit, so the call site names
 * neither the unit nor the format:
 *
 *     <Unit value={altitude} />
 *
 * Everything below is a property of THAT, rather than of a symbol handed in by
 * hand. The point of the redesign is that a widget cannot get any of it wrong,
 * because a widget no longer participates.
 */
describe("Unit: a value renders whole", () => {
  it("climbs the ladder without being asked", () => {
    // 12,400 m is 12.4 km. The widget passes metres and never mentions
    // kilometres; the rung is the model's decision.
    const { container } = render(<Unit value={value("m", 12_400)} />);
    expect(visibleText(container)).toBe("12.4 km");
  });

  it("announces the word rather than the letters", () => {
    // A screen reader says "kay em" for km, and nothing at all for a degree
    // sign. The word replaces the symbol in the accessibility tree so a
    // readout that SHOWS a unit ANNOUNCES one.
    render(<Unit value={value("m", 12_400)} />);
    expect(screen.getByText("kilometres")).toBeInTheDocument();
  });

  it("carries the spoken word as a tooltip too", () => {
    // For a sighted reader, who cannot hear the accessible name. This is the
    // disambiguation for two units that share a glyph; colour was rejected
    // under WCAG 1.4.1.
    const { container } = render(<Unit value={value("m", 12_400)} />);
    expect(container.querySelector("[data-unit]")).toHaveAttribute(
      "title",
      "kilometres",
    );
  });

  it("takes precision as a prop rather than letting a widget round first", () => {
    // The widget that wants one decimal asks for one. It does not format the
    // number itself and hand over a string, which is what the old shape
    // invited and what put eleven bespoke ladders in the codebase.
    const { container } = render(
      <Unit value={value("m", 12_400)} decimals={1} />,
    );
    expect(visibleText(container)).toBe("12.4 km");
  });

  it("shows a duration as a duration, with no stray unit beside it", () => {
    // Time is a ladder that climbs by 60 and 6 rather than by 1000, and it
    // shows two tiers at once because that is how a countdown reads. Its parts
    // are interleaved into the number, so there is no symbol to put after it:
    // rendering the RUNG here would print a stray "s" beside "2h 14min".
    const { container } = render(<Unit value={value("s", 8_040)} />);
    expect(visibleText(container)).toBe("2h 14min");
  });

  it("renders a currency as its glyph, and still says the word", () => {
    const { container } = render(<Unit value={value("science", 12.5)} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("science")).toBeInTheDocument();
  });

  it("shows a null value as the null token, with no unit beside it", () => {
    // A unit next to the null token reads as a measurement that happens to be
    // missing. It is not: there is nothing there.
    const { container } = render(<Unit value={null} />);
    expect(visibleText(container)).toBe(NULL_DISPLAY);
  });

  it("converts to a presentation unit on request", () => {
    // The wire carries kelvin and never Celsius, deliberately: a contract with
    // both tokens is how a channel came to send °C under a K label. Celsius is
    // asked for by name at the point of display.
    const { container } = render(<Unit value={value("K", 300)} as="°C" />);
    expect(visibleText(container)).toBe("27 °C");
  });

  it("shows a count as a bare integer", () => {
    // "3 count" is not a readout. The token names a category, so it renders
    // with no symbol and the caller supplies its own label.
    const { container } = render(<Unit value={value("count", 3)} />);
    expect(visibleText(container)).toBe("3");
  });
});

describe("Unit: format pins the unit", () => {
  it("re-expresses a value in another unit of the same kind", () => {
    // Orbital velocity is read in km/s in technical contexts and m/s
    // everywhere else. Neither follows from how big the number is, which is
    // exactly why the ladder cannot decide it.
    const { container } = render(
      <Unit value={value("m/s", 2_300)} format="km/s" />,
    );
    expect(visibleText(container)).toBe("2.3 km/s");
  });

  it("reaches a unit the ladder would never pick on its own", () => {
    // A launch broadcast quotes km/h for a lay audience. Speed has no ladder
    // at all, so this is only reachable by asking.
    const { container } = render(
      <Unit value={value("m/s", 100)} format="km/h" />,
    );
    expect(visibleText(container)).toBe("360.0 km/h");
  });

  it("holds the pinned unit instead of climbing away from it", () => {
    // 12,400 m would auto-scale to km. Pinning metres has to defeat that, or
    // the prop would be a suggestion.
    const { container } = render(
      <Unit value={value("m", 12_400)} format="m" />,
    );
    expect(visibleText(container)).toBe("12,400.0 m");
  });

  it("converts a rung whose symbol is gram-based on a kilogram value", () => {
    // Kerbin is 5.2915e22 kg. SystemView's hand-rolled version rendered that
    // as "52.91 Zg" by applying GRAM thresholds to a KILOGRAM value: the
    // digits were right and the prefix was a whole tier out, which is why it
    // went unnoticed. The correct answer has the same digits and the right
    // prefix, and the ratio comes off the model in kilograms so there is no
    // second base unit for the mistake to live in.
    const { container } = render(
      <Unit value={value("kg", 5.2915e22)} format="Yg" />,
    );
    expect(visibleText(container)).toBe("52.92 Yg");
  });

  it("ignores a format of a different kind rather than lying", () => {
    // Refused rather than applied: a wrong number under a right-looking label
    // is the failure this whole module exists to prevent. The type system
    // rejects this too; the runtime check is for a unit only known at runtime.
    const { container } = render(
      // @ts-expect-error: seconds are not a length
      <Unit value={value("m", 12_400)} format="s" />,
    );
    expect(visibleText(container)).toBe("12.4 km");
  });
});
