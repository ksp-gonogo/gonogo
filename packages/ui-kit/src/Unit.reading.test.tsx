import { type Reading, value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { NULL_DISPLAY } from "./NullValue";
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

function observed(magnitude: number): Reading<ReturnType<typeof metres>> {
  return {
    state: "observed",
    reckoning: "none",
    value: metres(magnitude),
    atUt: AT,
  };
}

function stale(
  magnitude: number,
  grade: "held-stale" | "disconnected" | "last-before-blackout" | "recorded",
): Reading<ReturnType<typeof metres>> {
  return {
    state: "stale",
    reckoning: "none",
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
    const withModel: Reading<ReturnType<typeof metres>> = {
      state: "observed",
      reckoning: "available",
      value: metres(12_400),
      atUt: AT,
      reckoned: {
        value: metres(99_900),
        atUt: AT,
        basis: "kepler-propagation",
        modelled: [],
        owner: "core",
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
    const { container } = render(<Unit value={{ state, reckoning: "none" }} />);
    expect(visibleText(container)).toBe(NULL_DISPLAY);
  });

  it("renders the null token for absent, the same as the other two", () => {
    // One treatment for three states. They differ in WHY there is no number,
    // and an operator reading one cell cannot act on the difference.
    const { container } = render(
      <Unit value={{ state: "absent", reckoning: "none", atUt: AT }} />,
    );
    expect(visibleText(container)).toBe(NULL_DISPLAY);
    expect(quantity(container).hasAttribute("data-not-current")).toBe(false);
  });

  it("does not fall through to the bare-symbol form", () => {
    // `shown` is null rather than undefined precisely so a valueless reading
    // still takes the quantity path. Handed children as well, the reading wins.
    const { container } = render(
      <Unit value={{ state: "pending", reckoning: "none" }}>km</Unit>,
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

  it("marks with a dotted underline in the inherited colour, never a tone", () => {
    // Tone belongs to the caller: an alert readout is red and a go readout is
    // green, and dimming here would compound with a caller that already dimmed.
    render(<Unit value={stale(12_400, "held-stale")} />);
    const css = emittedCss();
    expect(css).toContain("text-decoration-style:dotted");
    expect(css).not.toContain("--color-text-muted");
    expect(css).not.toContain("text-decoration-color");
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
    expect(quantity(container).getAttribute("title")).toBe(caption);
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
    expect(visibleText(container)).toBe("999.0 m4000.0 m");
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

  it("raises no a11y violation on either treatment", async () => {
    const { container } = render(
      <div>
        <Unit value={stale(12_400, "held-stale")} />
        <Unit value={observed(12_400)} />
        <Unit value={{ state: "pending", reckoning: "none" }} />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
