import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { MissionDate } from "./MissionDate";
import { NULL_DISPLAY } from "./NullValue";
import { visibleText } from "./testing";
import { Unit } from "./Unit";

/**
 * What the component inherits and refuses to inherit from its surroundings, and what it resolves from a unit token: display form, icon and spoken word.
 * Style assertions target `[data-unit]` because the visible symbol sits in a nested `aria-hidden` span whenever there is a word to say.
 */
function unitEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-unit]");
  if (!el) throw new Error("no unit rendered");
  return el;
}

describe("Unit: presentation", () => {
  it("sizes relative to the text it sits in, with a floor", () => {
    // jsdom drops `max()`, so a computed style would read back the parent's size; assert the emitted rule instead.
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

  it("keeps the value's colour at full strength, so the symbol reads at the value's contrast", () => {
    const { container } = render(<Unit>m/s</Unit>);
    expect(getComputedStyle(unitEl(container)).opacity).not.toBe("0.72");
    const css = Array.from(document.querySelectorAll("style"))
      .map((el) => el.textContent ?? "")
      .join("");
    expect(css).not.toContain("--color-text-muted");
    expect(css).not.toMatch(/opacity:0\.\d/);
  });

  it("resists a parent that uppercases", () => {
    // m and M are metre and mega.
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
    expect(style.marginInlineStart).toBe("0");
  });

  it("separates a number from its unit with a real character", () => {
    // A margin is invisible to the clipboard; the thin space copies as the space a reader expects.
    const { container } = render(<Unit value={value("m", 12_400)} />);
    expect(container.textContent).toContain("\u2009");
  });

  it("does not leak the spoken word into a copied readout", () => {
    // The spoken word must not land in the clipboard, or copying gives "12.4 km kilometres".
    const { container } = render(<Unit value={value("m", 12_400)} />);
    const hidden = container.querySelector("[data-unit] span + span");
    expect(getComputedStyle(hidden as Element).userSelect).toBe("none");
  });

  it("keeps the number and its unit on one line", () => {
    // The thin space is breakable, so the no-wrap protection comes from the wrapper.
    const { container } = render(<Unit value={value("m", 12_400)} />);
    expect(
      getComputedStyle(container.firstElementChild as Element).whiteSpace,
    ).toBe("nowrap");
  });

  it("writes a plane angle hard against its number, at full size", () => {
    // Plane angles attach ("22°", never "22 °") and keep full size, since a shrunk degree sign drops off cap height.
    const { container } = render(<Unit value={value("°", 22)} />);
    const style = getComputedStyle(unitEl(container));
    // No thin space before it, unlike every other unit.
    expect(container.textContent).not.toContain("\u2009");
    expect(style.fontSize).toBe("1em");
    // Nor dimmed: a plane angle is part of the number's own typography.
    expect(style.opacity).toBe("1");
  });

  it("does NOT attach degrees Celsius, which takes the normal space", () => {
    // The exception is plane angle only: Celsius spaces like any other unit.
    const { container } = render(<Unit value={value("K", 300)} as="°C" />);
    expect(container.textContent).toContain("\u2009");
  });
});

describe("Unit: what it resolves from the model", () => {
  it("shows the kind's display form, not the token", () => {
    // `funds` displays as `f`: the call site names the unit and the model decides how it looks.
    const { container } = render(<Unit>funds</Unit>);
    expect(unitEl(container).textContent).toBe("f funds");
  });

  it("renders an icon where the model has one, and still says the word", () => {
    // Icons are aria-hidden, so without the word an icon unit announces a bare number.
    const { container } = render(<Unit>science</Unit>);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(unitEl(container).textContent).toBe(" science");
  });

  it("says the word INSTEAD of the symbol, not as well as it", () => {
    // Announcing both would read as "kay em kilometres".
    render(<Unit>km</Unit>);
    expect(screen.getByText("km")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("kilometres")).toBeInTheDocument();
  });

  it("says a word for a symbol that announces as nothing at all", () => {
    // The degree sign is silent to a screen reader, so without the word the unit is absent.
    const { container } = render(<Unit>{"°"}</Unit>);
    expect(unitEl(container).textContent).toBe("° degrees");
  });

  it("keeps an unknown symbol announceable rather than silent", () => {
    // A symbol with no word stays announced rather than the unit vanishing.
    render(<Unit>qz</Unit>);
    expect(screen.getByText("qz")).not.toHaveAttribute("aria-hidden");
  });

  it("renders nothing for a kind that names a category", () => {
    // Category kinds name what a field is, not a unit, so there is nothing to show or announce.
    const { container } = render(<Unit>count</Unit>);
    expect(container.querySelector("[data-unit]")).toBeNull();
  });
});

/** The headline form: a value carries its own unit, so the call site names neither the unit nor the format. */
describe("Unit: a value renders whole", () => {
  it("climbs the ladder without being asked", () => {
    // The widget passes metres; the rung is the model's decision.
    const { container } = render(<Unit value={value("m", 12_400)} />);
    expect(visibleText(container)).toBe("12.4 km");
  });

  it("announces the word rather than the letters", () => {
    // The word replaces the symbol in the accessibility tree, so a readout that shows a unit announces one.
    render(<Unit value={value("m", 12_400)} />);
    expect(screen.getByText("kilometres")).toBeInTheDocument();
  });

  it("carries the spoken word as a tooltip too", () => {
    // The title disambiguates units that share a glyph for a sighted reader.
    const { container } = render(<Unit value={value("m", 12_400)} />);
    expect(container.querySelector("[data-unit]")).toHaveAttribute(
      "title",
      "kilometres",
    );
  });

  it("takes precision as a prop rather than letting a widget round first", () => {
    const { container } = render(
      <Unit value={value("m", 12_400)} decimals={1} />,
    );
    expect(visibleText(container)).toBe("12.4 km");
  });

  it("shows a duration as a duration, with no stray unit beside it", () => {
    // A duration interleaves its parts into the number with no symbol after it; rendering the rung would print a stray "s".
    const { container } = render(<Unit value={value("s", 8_040)} />);
    expect(visibleText(container)).toBe("2h 14min");
  });

  it("renders a currency as its glyph, and still says the word", () => {
    const { container } = render(<Unit value={value("science", 12.5)} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("science")).toBeInTheDocument();
  });

  it("shows a null value as the null token, with no unit beside it", () => {
    // A unit beside the null token would read as a measurement that happens to be missing.
    const { container } = render(<Unit value={null} />);
    expect(visibleText(container)).toBe(NULL_DISPLAY);
  });

  it("shows an absent value as the null token rather than as nothing", () => {
    // A reading that has not arrived gets the same token as an explicit null: there is no number here, and blank space cannot say so.
    const { container } = render(<Unit value={undefined} />);
    expect(visibleText(container)).toBe(NULL_DISPLAY);
  });

  it("shows the null token when handed neither a value nor a symbol", () => {
    const { container } = render(<Unit />);
    expect(visibleText(container)).toBe(NULL_DISPLAY);
  });

  it("shows a zero as a zero, since a zero is a reading", () => {
    // Absence and zero are different answers: a tank reading empty has been read.
    const { container } = render(<Unit value={value("m/s", 0)} />);
    expect(visibleText(container)).toBe("0.0 m/s");
  });

  it("renders a bare symbol from the symbol-only children form", () => {
    // A token with no value is asking for a symbol, not a missing reading.
    const { container } = render(<Unit>km</Unit>);
    expect(visibleText(container)).toBe("km");
  });

  it("converts to a presentation unit on request", () => {
    // The wire carries kelvin only; Celsius is asked for by name at the point of display.
    const { container } = render(<Unit value={value("K", 300)} as="°C" />);
    expect(visibleText(container)).toBe("27 °C");
  });

  it("shows a count as a bare integer", () => {
    // A category token renders no symbol; the caller supplies its own label.
    const { container } = render(<Unit value={value("count", 3)} />);
    expect(visibleText(container)).toBe("3");
  });
});

describe("Unit: format pins the unit", () => {
  it("re-expresses a value in another unit of the same kind", () => {
    // Convention, not magnitude, decides km/s against m/s, so the ladder cannot.
    const { container } = render(
      <Unit value={value("m/s", 2_300)} format="km/s" />,
    );
    expect(visibleText(container)).toBe("2.3 km/s");
  });

  it("reaches a unit the ladder would never pick on its own", () => {
    // Speed has no ladder to km/h, so it is only reachable by asking.
    const { container } = render(
      <Unit value={value("m/s", 100)} format="km/h" />,
    );
    expect(visibleText(container)).toBe("360.0 km/h");
  });

  it("holds the pinned unit instead of climbing away from it", () => {
    // Pinning metres must defeat the auto-scale, or the prop is only a suggestion.
    const { container } = render(
      <Unit value={value("m", 12_400)} format="m" />,
    );
    expect(visibleText(container)).toBe("12,400.0 m");
  });

  it("converts a rung whose symbol is gram-based on a kilogram value", () => {
    // A kilogram value takes kilogram thresholds, not gram ones, so Kerbin reads in the right prefix tier.
    const { container } = render(
      <Unit value={value("kg", 5.2915e22)} format="Yg" />,
    );
    expect(visibleText(container)).toBe("52.92 Yg");
  });

  it("ignores a format of a different kind rather than lying", () => {
    // A cross-kind pin is refused rather than applied; the runtime check covers a unit only known at runtime.
    const { container } = render(
      // @ts-expect-error: seconds are not a length
      <Unit value={value("m", 12_400)} format="s" />,
    );
    expect(visibleText(container)).toBe("12.4 km");
  });
});

// A UT is an instant: `<Unit>` renders it as a mission date, never as a grouped decimal or a duration.
describe("Unit: a universal time renders as a date, not a decimal", () => {
  it("renders a mission date rather than a grouped number", () => {
    const { container } = render(<Unit value={value("ut", 12_345_678)} />);

    const shown = visibleText(container);
    // The magnitude is large enough that a decimal rendering is unmistakable.
    expect(shown).not.toMatch(/12,345,678/);
    expect(shown).toMatch(/^Y\d+ D\d+ \d{2}:\d{2}:\d{2}$/);
  });

  it("agrees exactly with <MissionDate> for the same instant", () => {
    // Asserted as a property rather than a pinned string, so a calendar change moves both together.
    const viaUnit = render(<Unit value={value("ut", 12_345_678)} />);
    const unitText = visibleText(viaUnit.container);
    viaUnit.unmount();

    const viaDate = render(<MissionDate value={12_345_678} />);
    expect(unitText).toBe(visibleText(viaDate.container));
  });

  it("does not render a UT as a duration", () => {
    // The same magnitude as a duration is "1y 145d".
    const { container } = render(<Unit value={value("ut", 12_345_678)} />);

    expect(visibleText(container)).not.toMatch(/\d+y \d+d/);
  });

  it("still gives the raw number when the caller opts out of scaling", () => {
    // `scale="never"` means the reading in its declared unit, which for an instant is the UT itself.
    const { container } = render(
      <Unit value={value("ut", 12_345_678)} scale="never" />,
    );

    expect(visibleText(container)).toMatch(/12,345,678|12345678/);
  });
});
