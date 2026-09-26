import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { NULL_DISPLAY } from "./NullValue";
import { severityDotColor } from "./status/severityDotColor";
// From the source, not the published subpath, which resolves to the last build.
import { visibleText } from "./testing";
import { Unit } from "./Unit";
import { UnitSharedFormat } from "./UnitSharedFormat";

// What `<Unit>` draws for a whole `Reading`: five states collapse to three treatments, and these tests pin the collapse.

const AT = value("ut", 1_000);
/** What `formatKspDate` makes of {@link AT} on the stock calendar. */
const AT_DATE = "Y1 D1 00:16:40";

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

/** The emitted stylesheet, where a style rule is assertable. */
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

/** Just the rules emitted for the mark, since any other component on the page may contain a hex. */
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
    // A mark present in the normal case is one the operator stops seeing.
    const { container } = render(<Unit value={observed(12_400)} />);
    expect(container.querySelector("[data-unit-currency]")).toBeNull();
    expect(container.textContent).not.toMatch(/STALE|BLACKOUT|RECORDED/);
  });

  it("treats a reading with a model on offer as current, and never draws it", () => {
    // A modelled figure replacing an observed one has to be a written choice at the call site.
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
    // One treatment for three states: an operator reading one cell cannot act on why there is no number.
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
    // A valueless reading takes the quantity path, and wins over children.
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
    expect(css).toContain("border-radius:var(--radius-circle)");
  });

  it("takes the dot's hue from the same token the panel badge paints", () => {
    // One fact, one colour: the mark and the badge above it are the same `warning` severity.
    render(<Unit value={stale(12_400, "held-stale")} />);
    const css = emittedCss();
    expect(css).toContain(severityDotColor("warning"));
  });

  it("paints the dot from a token and never from a literal hue", () => {
    // A hex typed in here is a hue the theme cannot restyle.
    const { container } = render(<Unit value={stale(12_400, "held-stale")} />);
    expect(markRule(container)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("does not change what the readout occupies", () => {
    // A glyph in the flow would reflow a table column every time a channel went quiet.
    const { container: marked } = render(
      <Unit value={stale(12_400, "held-stale")} />,
    );
    const { container: plain } = render(<Unit value={metres(12_400)} />);
    expect(visibleText(marked)).toBe(visibleText(plain));
  });

  it("takes the dot out of the inline flow, so no column can reflow", () => {
    // jsdom has no layout, so assert the rule that makes the mark zero-width: it is absolutely positioned.
    const { container } = render(<Unit value={stale(12_400, "held-stale")} />);
    expect(markRule(container)).toContain("position:absolute");
  });

  it.each([
    ["held-stale", "STALE"],
    ["disconnected", "OFFLINE"],
    ["last-before-blackout", "BLACKOUT"],
    ["recorded", "RECORDED"],
  ] as const)("says %s as %s, and shows it on hover", (grade, caption) => {
    // One visible treatment for all four grades, with the grade spoken in `formatStreamStatus`'s own words.
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
    // A stale member still reports, so a column's rung does not move when one cell stops updating.
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
  // The hover and caption say how stale, from `asOfUt` on the game's calendar, so a held number and a `<MissionDate>` beside it print one spelling of one instant.
  it("puts the date on the hover, beside the grade", () => {
    const { container } = render(<Unit value={stale(12_400, "held-stale")} />);
    expect(quantity(container).getAttribute("title")).toBe(
      `STALE, as of ${AT_DATE}`,
    );
  });

  it("says the date out loud too, in the caption that is already there", () => {
    // One spoken caption, extended; a second hidden node would announce the grade twice.
    const { container } = render(<Unit value={stale(12_400, "recorded")} />);
    const said = container.querySelectorAll("[data-unit-currency]");
    expect(said).toHaveLength(1);
    expect(said[0]?.textContent).toBe(`, RECORDED, as of ${AT_DATE}`);
  });

  it("keeps the date off the screen and off the clipboard", () => {
    // It is a reading of the mark beside it, so copying a readout must not pick it up.
    const { container } = render(<Unit value={stale(12_400, "held-stale")} />);
    expect(visibleText(container)).toBe("12.4 km");
  });

  it("reads the instant on the game's calendar, not as a bare number", () => {
    // The date goes through `formatQuantity`, never as "1,000.00 ut".
    const { container } = render(<Unit value={stale(12_400, "held-stale")} />);
    expect(quantity(container).getAttribute("title")).not.toMatch(/\but\b/);
    expect(quantity(container).getAttribute("title")).toMatch(/Y\d+ D\d+/);
  });

  it("never draws a silent mark: a held reading naming no grade still speaks", () => {
    // A derived reading can be stale with an observed oldest input; the word is grade-neutral rather than asserting a reason nobody reported.
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
    // A malformed `asOfUt` must not turn the hover into an "as of" followed by the null token.
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
    // WCAG 1.4.1: the mark is a shape, silent itself, with the meaning said in words by the hover and caption.
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
 * What `<Unit>` draws when a held reading's model publishes an interval.
 * `±` reads as an offset from the number beside it, so it is used only when the band is symmetric and about the figure on screen; anything else prints the range.
 */

function banded(
  magnitude: number,
  band: { lo: number; value: number; hi: number; kind?: "bound" | "sigma1" },
  state: "observed" | "stale" = "stale",
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
  it("draws no interval beside a current reading", () => {
    const { container } = render(
      <Unit
        value={banded(1000, { lo: 1180, value: 1200, hi: 1220 }, "observed")}
        decimals={3}
      />,
    );
    expect(visibleText(container)).toBe("1.000 km");
    expect(container.querySelector("[data-unit-band]")).toBeNull();
    expect(quantity(container).getAttribute("title")).toBeNull();
  });

  it("draws ends that print as the same text as one approximate figure, the way Band does", () => {
    const { container } = render(
      <Unit
        value={banded(780, { lo: 830, value: 830, hi: 830 })}
        decimals={3}
      />,
    );
    const band = container.querySelector("[data-unit-band]");
    expect(visibleText(container)).toBe("780.000 m (~830.000 m)");
    expect(band?.textContent).toContain("approximately");
    expect(band?.textContent?.match(/830/g)).toHaveLength(1);
  });

  it("collapses ends the display cannot tell apart, not only equal ones", () => {
    const { container } = render(
      <Unit
        value={banded(1000, { lo: 1199.9999, value: 1200, hi: 1200.0001 })}
        decimals={3}
      />,
    );
    expect(visibleText(container)).toBe("1.000 km (~1.200 km)");
  });

  it("writes no interval whose one figure is the figure already on screen", () => {
    const { container } = render(
      <Unit
        value={banded(1000, { lo: 1000, value: 1000, hi: 1000 })}
        decimals={3}
      />,
    );
    expect(visibleText(container)).toBe("1.000 km");
    expect(container.querySelector("[data-unit-band]")).toBeNull();
  });

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
    // `±` over an asymmetric band would misstate the interval's shape.
    const { container } = render(
      <Unit
        value={banded(1000, { lo: 970, value: 1000, hi: 1030.6 })}
        decimals={3}
      />,
    );
    expect(visibleText(container)).toBe("1.000 km (0.970 to 1.031 km)");
  });

  it("falls back to the range where the model has left the figure behind", () => {
    // Symmetric about where the model says the value is now, not the observation on screen, so `±` would bracket the wrong figure.
    const { container } = render(
      <Unit
        value={banded(1000, { lo: 1180, value: 1200, hi: 1220 }, "stale")}
        decimals={3}
      />,
    );
    expect(visibleText(container)).toBe("1.000 km (1.180 to 1.220 km)");
  });

  it("draws nothing where the model offers a figure and no interval", () => {
    // An absent band is never evidence that a value is well known, so it draws as silence.
    const { container } = render(<Unit value={observed(1000)} />);
    expect(container.querySelector("[data-unit-band]")).toBeNull();
  });

  it("ignores a band the model wrote in some other unit", () => {
    // A band in another unit draws nothing rather than an interval a reader would take for metres.
    const { container } = render(
      <Unit
        value={{
          state: "stale",
          value: metres(1000),
          asOfUt: AT,
          grade: "held-stale",
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
    // The claim is a clause, so it goes in the hover rather than inline.
    const { container } = render(
      <Unit
        value={banded(1000, { lo: 975, value: 1000, hi: 1025 })}
        decimals={3}
      />,
    );
    expect(quantity(container).getAttribute("title")).toMatch(
      /, with bands at 0\.975 kilometres and 1\.025 kilometres$/,
    );
  });

  it("says a hard bound's interval the same way as a sigma1 one", () => {
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
    expect(quantity(container).getAttribute("title")).toMatch(
      /, with bands at 0\.975 kilometres and 1\.025 kilometres$/,
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
    expect(title).toContain("with bands at");
  });

  it("raises no a11y violation with an interval drawn", async () => {
    const { container } = render(
      <Unit value={banded(1000, { lo: 975, value: 1000, hi: 1025 })} />,
    );
    await expectNoA11yViolations(container);
  });
});
