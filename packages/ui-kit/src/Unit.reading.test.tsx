import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { NULL_DISPLAY } from "./NullValue";
import { severityDotColor } from "./status/severityDotColor";
// `visibleText` from the SOURCE, not from the published subpath: this file
// changes what counts as visible, and the subpath resolves to the last build.
import { visibleText } from "./testing";
import { Unit } from "./Unit";
import { UnitSharedFormat } from "./UnitSharedFormat";

/**
 * The staleness slot: what `<Unit>` draws when it is handed a whole `Reading`
 * rather than a bare `Value`.
 *
 * `Reading` is five states across two reckoning arms and this file has THREE
 * treatment tests, which is the design and not a gap. See the component's own
 * header for why the four stale grades are one treatment and why the three
 * valueless states are another; the tests below pin that collapsing, so a later
 * edit that starts drawing a fourth thing fails here rather than in a review.
 */

const AT = value("ut", 1_000);
/** What `formatKspDate` makes of {@link AT} on the stock calendar. */
const AT_DATE = "Y1 D1 00:16:40";

/*
 * Plain object literals, and no `topicReading` anywhere. The primitive takes a
 * PER-VALUE `Reading` now, which has no field half to project, so the proxy the
 * whole-topic form needs would be building twenty-six field readings over a
 * `Value`'s own methods for a component that reads five properties.
 */
function observed(magnitude: number): Reading<Value<"m">> {
  return {
    state: "observed",
    reckoning: { status: "none" },
    value: metres(magnitude),
    atUt: AT,
  };
}

function stale(
  magnitude: number,
  grade: "held-stale" | "disconnected" | "last-before-blackout" | "recorded",
): Reading<Value<"m">> {
  return {
    state: "stale",
    reckoning: { status: "none" },
    value: metres(magnitude),
    asOfUt: AT,
    grade,
  };
}

function metres(magnitude: number) {
  return value("m", magnitude);
}

/** The emitted stylesheet, which is where a text decoration is assertable. */
function emittedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((el) => el.textContent ?? "")
    .join("");
}

function quantity(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("span");
  if (!el) throw new Error("nothing rendered");
  return el;
}

/**
 * Just the declarations styled-components emitted for the mark, rather than the
 * whole sheet.
 *
 * The narrowing is the point: "the stylesheet contains no hex" is false of any
 * page that renders a second component, so an assertion about THIS rule has to
 * find this rule.
 */
function markRule(container: HTMLElement): string {
  const mark = container.querySelector<HTMLElement>("[data-not-current-mark]");
  if (!mark) throw new Error("no mark rendered");
  const css = emittedCss();
  return Array.from(mark.classList)
    .flatMap((cls) => css.match(new RegExp(`\\.${cls}\\{[^}]*\\}`, "g")) ?? [])
    .join("");
}

describe("Unit: a reading that is current", () => {
  it("draws an observed reading exactly as the bare value", () => {
    const { container: fromReading } = render(
      <Unit value={observed(12_400)} />,
    );
    const { container: fromValue } = render(<Unit value={metres(12_400)} />);
    expect(visibleText(fromReading)).toBe(visibleText(fromValue));
    expect(quantity(fromReading).hasAttribute("data-not-current")).toBe(false);
  });

  it("says nothing extra about a current reading", () => {
    /*
     * The same rule `formatStreamStatus` follows for `live`: a mark present in
     * the normal case is one the operator stops seeing, and a word said on
     * every healthy cell is one a screen-reader user stops hearing.
     */
    const { container } = render(<Unit value={observed(12_400)} />);
    expect(container.querySelector("[data-unit-currency]")).toBeNull();
    expect(container.textContent).not.toMatch(/STALE|BLACKOUT|RECORDED/);
  });

  it("treats a reading with a model on offer as current, and never draws it", () => {
    // A modelled figure replacing an observed one has to be a written choice at
    // the call site. A primitive doing it silently is the substitution the whole
    // type exists to prevent.
    const withModel: Reading<Value<"m">> = {
      state: "observed",
      value: metres(12_400),
      atUt: AT,
      reckoning: {
        status: "available",
        modelled: metres(99_900),
        basis: "kepler-propagation",
      },
    };
    const { container } = render(<Unit value={withModel} />);
    expect(visibleText(container)).toBe("12.4 km");
    expect(quantity(container).hasAttribute("data-not-current")).toBe(false);
  });
});

describe("Unit: a reading with no number", () => {
  it.each([
    "pending",
    "unowned",
  ] as const)("renders the null token for %s", (state) => {
    const { container } = render(
      <Unit value={{ state, reckoning: { status: "none" } }} />,
    );
    expect(visibleText(container)).toBe(NULL_DISPLAY);
  });

  it("renders the null token for absent, the same as the other two", () => {
    // One treatment for three states. They differ in WHY there is no number,
    // and an operator reading one cell cannot act on the difference.
    const { container } = render(
      <Unit
        value={{
          state: "absent",
          reckoning: { status: "none" },
          atUt: AT,
        }}
      />,
    );
    expect(visibleText(container)).toBe(NULL_DISPLAY);
    expect(quantity(container).hasAttribute("data-not-current")).toBe(false);
  });

  it("does not fall through to the bare-symbol form", () => {
    // `shown` is null rather than undefined precisely so a valueless reading
    // still takes the quantity path. Handed children as well, the reading wins.
    const { container } = render(
      <Unit
        value={{
          state: "pending",
          reckoning: { status: "none" },
        }}
      >
        km
      </Unit>,
    );
    expect(visibleText(container)).toBe(NULL_DISPLAY);
  });
});

describe("Unit: a reading that is not current", () => {
  it("draws the last observation in full, and marks it", () => {
    // Still the best number available, so it is drawn and not withheld.
    const { container } = render(<Unit value={stale(12_400, "held-stale")} />);
    expect(visibleText(container)).toBe("12.4 km");
    expect(quantity(container).hasAttribute("data-not-current")).toBe(true);
  });

  it("marks with a superscript dot, and draws no underline under the value", () => {
    const { container } = render(<Unit value={stale(12_400, "held-stale")} />);
    expect(container.querySelector("[data-not-current-mark]")).not.toBeNull();
    const css = emittedCss();
    expect(css).not.toContain("text-decoration-style:dotted");
    // Round off the radius ladder's own circle token, not a hand-typed 50%.
    expect(css).toContain("border-radius:var(--radius-circle)");
  });

  it("takes the dot's hue from the same token the panel badge paints", () => {
    // One fact, one colour: the mark on the cell and the pill above it are the
    // same `warning` severity, and `severityDotColor` is where that is decided.
    render(<Unit value={stale(12_400, "held-stale")} />);
    const css = emittedCss();
    expect(css).toContain(severityDotColor("warning"));
  });

  it("paints the dot from a token and never from a literal hue", () => {
    // A hex typed in here is a hue the theme cannot restyle, and a second place
    // the staleness colour would have to be kept in step with the badge.
    const { container } = render(<Unit value={stale(12_400, "held-stale")} />);
    expect(markRule(container)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("does not change what the readout occupies", () => {
    // A prefix or suffix glyph would reflow a table column every time a channel
    // went quiet, which is the loudest possible way to say something quiet.
    const { container: marked } = render(
      <Unit value={stale(12_400, "held-stale")} />,
    );
    const { container: plain } = render(<Unit value={metres(12_400)} />);
    expect(visibleText(marked)).toBe(visibleText(plain));
  });

  it("takes the dot out of the inline flow, so no column can reflow", () => {
    /*
     * The whole reason a glyph was refused before this. jsdom has no layout, so
     * what is assertable here is the RULE that makes a zero-width mark: the dot
     * is absolutely positioned and therefore contributes nothing to the line
     * box. The measurement in a real engine lives in
     * `scripts/render-unit-currency.ts`, which lays the same table out marked
     * and unmarked and reports both widths.
     */
    const { container } = render(<Unit value={stale(12_400, "held-stale")} />);
    expect(markRule(container)).toContain("position:absolute");
  });

  it.each([
    ["held-stale", "STALE"],
    ["disconnected", "OFFLINE"],
    ["last-before-blackout", "BLACKOUT"],
    ["recorded", "RECORDED"],
  ] as const)("says %s as %s, and shows it on hover", (grade, caption) => {
    /*
     * One visible treatment for all four, and four SPOKEN captions: the words
     * are `formatStreamStatus`'s own, so a number and the badge above it
     * cannot use two words for one fact.
     */
    const { container } = render(<Unit value={stale(12_400, grade)} />);
    expect(quantity(container).getAttribute("title")).toBe(
      `${caption}, as of ${AT_DATE}`,
    );
    expect(container.textContent).toContain(caption);
    expect(visibleText(container)).toBe("12.4 km");
  });

  it("keeps the caption off the clipboard and off the screen", () => {
    const { container } = render(<Unit value={stale(12_400, "recorded")} />);
    const said = container.querySelector<HTMLElement>("[data-unit-currency]");
    expect(said).not.toBeNull();
    expect(emittedCss()).toContain("user-select:none");
  });

  it("reports into a UnitSharedFormat exactly as a live reading does", () => {
    // A column whose rung moved when one cell stopped updating would rewrite
    // every other cell in it. The report carries the number and nothing else.
    const { container } = render(
      <UnitSharedFormat>
        <Unit value={stale(999, "held-stale")} />
        <Unit value={metres(4_000)} />
      </UnitSharedFormat>,
    );
    expect(visibleText(container)).toBe("1.0 km4.0 km");
  });
});

describe("Unit: when the reading was last valid", () => {
  /*
   * HOW stale a number is, which the mark itself deliberately does not say.
   * The dot answers the yes-or-no question at a glance; the date answers the
   * follow-up, on demand, where it costs the glance nothing.
   *
   * It comes off `asOfUt`, which the reading already carries, and renders
   * through `formatQuantity` on the game's own calendar, so a held number and
   * a `<MissionDate>` beside it cannot print two spellings of one instant.
   */
  it("puts the date on the hover, beside the grade", () => {
    const { container } = render(<Unit value={stale(12_400, "held-stale")} />);
    expect(quantity(container).getAttribute("title")).toBe(
      `STALE, as of ${AT_DATE}`,
    );
  });

  it("says the date out loud too, in the caption that is already there", () => {
    // ONE spoken caption, extended. A second hidden node would announce the
    // grade twice on every stale cell on the screen.
    const { container } = render(<Unit value={stale(12_400, "recorded")} />);
    const said = container.querySelectorAll("[data-unit-currency]");
    expect(said).toHaveLength(1);
    expect(said[0]?.textContent).toBe(`, RECORDED, as of ${AT_DATE}`);
  });

  it("keeps the date off the screen and off the clipboard", () => {
    // It is a reading of the mark beside it, not extra content, on the same
    // terms as the spoken unit word.
    const { container } = render(<Unit value={stale(12_400, "held-stale")} />);
    expect(visibleText(container)).toBe("12.4 km");
  });

  it("reads the instant on the game's calendar, not as a bare number", () => {
    /*
     * A UT rendered as "1,000.00 ut" is a true statement about a quantity
     * nobody reads. `formatQuantity` already refuses to do that; this pins
     * that the date goes through it rather than around it.
     */
    const { container } = render(<Unit value={stale(12_400, "held-stale")} />);
    expect(quantity(container).getAttribute("title")).not.toMatch(/\but\b/);
    expect(quantity(container).getAttribute("title")).toMatch(/Y\d+ D\d+/);
  });

  it("never draws a silent mark: a held reading naming no grade still speaks", () => {
    /*
     * Not a corner case: a derived reading is stale when any input is, and
     * takes its grade from whichever input speaks for the oldest instant, so
     * an observed input that happens to be the oldest produces exactly this.
     * The word is grade-neutral on purpose: STALE, BLACKOUT and RECORDED ask
     * the operator for different moves, and any one of them here would assert
     * a reason nobody reported.
     */
    const { container } = render(
      <Unit
        value={{
          state: "stale",
          reckoning: { status: "none" },
          value: metres(12_400),
          asOfUt: AT,
        }}
      />,
    );
    expect(quantity(container).getAttribute("title")).toBe(
      `HELD, as of ${AT_DATE}`,
    );
    const said = container.querySelectorAll("[data-unit-currency]");
    expect(said).toHaveLength(1);
    expect(said[0]?.textContent).toBe(`, HELD, as of ${AT_DATE}`);
  });

  it("falls back to the grade alone when the instant is unreadable", () => {
    // A malformed `asOfUt` must not turn the hover into an "as of" followed by
    // the null token.
    const { container } = render(
      <Unit
        value={{
          state: "stale",
          reckoning: { status: "none" },
          value: metres(12_400),
          asOfUt: value("ut", Number.NaN),
          grade: "held-stale",
        }}
      />,
    );
    expect(quantity(container).getAttribute("title")).toBe("STALE");
  });
});

describe("Unit: the staleness slot is announced", () => {
  it("reaches a screen reader with the number and its caption", async () => {
    render(
      <p>
        Range <Unit value={stale(12_400, "last-before-blackout")} />
      </p>,
    );
    expect(await screen.findByText(/BLACKOUT/)).toBeTruthy();
  });

  it("carries the meaning without the hue, and draws no dot on a current one", () => {
    /*
     * WCAG 1.4.1. The mark is a SHAPE: a dot that is there or is not, so a
     * reader who cannot tell amber from grey still reads it, and the hover and
     * the caption say it in words for one who cannot see it at all. The dot
     * itself is silent, or every stale cell would announce a bullet.
     */
    const { container } = render(<Unit value={stale(12_400, "held-stale")} />);
    const dot = container.querySelector<HTMLElement>("[data-not-current-mark]");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    expect(dot?.textContent).toBe("");
    expect(quantity(container).getAttribute("title")).toContain("STALE");

    const { container: live } = render(<Unit value={observed(12_400)} />);
    expect(live.querySelector("[data-not-current-mark]")).toBeNull();
  });

  it("raises no a11y violation on either treatment", async () => {
    const { container } = render(
      <div>
        <Unit value={stale(12_400, "held-stale")} />
        <Unit value={observed(12_400)} />
        <Unit
          value={{
            state: "pending",
            reckoning: { status: "none" },
          }}
        />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});

/**
 * The band slot: what `<Unit>` draws when the reading's model publishes an
 * interval as well as a figure.
 *
 * Two forms rather than one, and which one is used is the whole subject here.
 * `±` is read as an offset from the number beside it, so it is only ever the
 * same statement the two ends make when the band is symmetric AND about the
 * figure on screen. Everything that is not both falls back to the range, which
 * prints the model's own numbers and cannot misstate them.
 */

function banded(
  magnitude: number,
  band: { lo: number; value: number; hi: number; kind?: "bound" | "sigma1" },
  state: "observed" | "stale" = "observed",
): Reading<Value<"m">> {
  const reckoning = {
    status: "available",
    modelled: metres(band.value),
    basis: "linear-dead-reckoning",
    band: {
      value: metres(band.value),
      lo: metres(band.lo),
      hi: metres(band.hi),
      kind: band.kind ?? "sigma1",
    },
  } as const;
  return state === "stale"
    ? {
        state: "stale",
        value: metres(magnitude),
        asOfUt: AT,
        grade: "held-stale",
        reckoning,
      }
    : { state: "observed", value: metres(magnitude), atUt: AT, reckoning };
}

describe("Unit: how well the number is known", () => {
  it("writes a symmetric band about the shown figure as a tolerance", () => {
    const { container } = render(
      <Unit
        value={banded(1000, { lo: 975, value: 1000, hi: 1025 })}
        decimals={3}
      />,
    );
    expect(visibleText(container)).toBe("1.000 km ± 0.025 km");
  });

  it("falls back to the range where the two sides disagree", () => {
    /*
     * A fitted band is routinely asymmetric, and `±` over one keeps a half and
     * discards the other: that misstates the interval's shape rather than
     * rounding its width.
     */
    const { container } = render(
      <Unit
        value={banded(1000, { lo: 970, value: 1000, hi: 1030.6 })}
        decimals={3}
      />,
    );
    expect(visibleText(container)).toBe("1.000 km (0.970 to 1.031 km)");
  });

  it("falls back to the range where the model has left the figure behind", () => {
    /*
     * The held case, and the reason the short form asks about the ANCHOR and
     * not only about symmetry. The interval is symmetric about where the model
     * says the value is now, which is not the observation on screen, so a `±`
     * here would bracket the wrong figure.
     */
    const { container } = render(
      <Unit
        value={banded(1000, { lo: 1180, value: 1200, hi: 1220 }, "stale")}
        decimals={3}
      />,
    );
    expect(visibleText(container)).toBe("1.000 km (1.180 to 1.220 km)");
  });

  it("draws nothing where the model offers a figure and no interval", () => {
    // A model can be available and honestly bound nothing. An absent band is
    // never evidence that a value is well known, so it draws as silence.
    const { container } = render(<Unit value={observed(1000)} />);
    expect(container.querySelector("[data-unit-band]")).toBeNull();
  });

  it("ignores a band the model wrote in some other unit", () => {
    // `bandIn` refuses to narrow it, and a number with no interval beside it
    // beats an interval a reader would take for metres.
    const { container } = render(
      <Unit
        value={{
          state: "observed",
          value: metres(1000),
          atUt: AT,
          reckoning: {
            status: "available",
            modelled: metres(1000),
            basis: "linear-dead-reckoning",
            band: {
              value: value("s", 1000),
              lo: value("s", 975),
              hi: value("s", 1025),
              kind: "sigma1",
            },
          },
        }}
      />,
    );
    expect(container.querySelector("[data-unit-band]")).toBeNull();
  });

  it("says what the interval CLAIMS in the hover, not beside the numbers", () => {
    /*
     * A hard bound and a one-sigma interval are the same two numbers until
     * something says which, and they are worth very different amounts. The
     * qualifier is a clause, and a clause inline would double the length of
     * every banded readout in a table.
     */
    const { container } = render(
      <Unit
        value={banded(1000, { lo: 975, value: 1000, hi: 1025 })}
        decimals={3}
      />,
    );
    expect(quantity(container).getAttribute("title")).toBe(
      "between 0.975 kilometres and 1.025 kilometres about two thirds of the time",
    );
  });

  it("leaves a hard bound unqualified, which is the stronger claim", () => {
    const { container } = render(
      <Unit
        value={banded(1000, {
          lo: 975,
          value: 1000,
          hi: 1025,
          kind: "bound",
        })}
        decimals={3}
      />,
    );
    expect(quantity(container).getAttribute("title")).toBe(
      "between 0.975 kilometres and 1.025 kilometres",
    );
  });

  it("keeps the staleness sentence when both have something to say", () => {
    const { container } = render(
      <Unit
        value={banded(1000, { lo: 1180, value: 1200, hi: 1220 }, "stale")}
      />,
    );
    const title = quantity(container).getAttribute("title") ?? "";
    expect(title).toContain("STALE");
    expect(title).toContain("between");
  });

  it("raises no a11y violation with an interval drawn", async () => {
    const { container } = render(
      <Unit value={banded(1000, { lo: 975, value: 1000, hi: 1025 })} />,
    );
    await expectNoA11yViolations(container);
  });
});
