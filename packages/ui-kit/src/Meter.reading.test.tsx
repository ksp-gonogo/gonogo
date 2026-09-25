import {
  type Reading,
  type UncertaintyBand,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Meter } from "./Meter";
import { NULL_DISPLAY } from "./NullValue";
import { formatQuantity } from "./units";

/**
 * The reckoning slot: what `<Meter>` draws when it is handed a whole `Reading`
 * rather than a bare quantity.
 *
 * Three things come off the readings and only three: whether the bar is a
 * reading of NOW, which it draws the way `<Unit>` does; the VALUE's band, which
 * it draws as one mark per bound where the value is; and the CAPACITY's band,
 * which it draws at the track's end, because the end is one whole and an
 * uncertain whole is an uncertain end. The two are never merged, which the last
 * describe block pins.
 *
 * The band LOOKUP is what these tests pin to the primitive: a call site that had
 * to reach `reckoning.band` itself would be deciding both what an absent one
 * means and what unit the interval arrived in, and sixty widgets deciding that
 * separately is the visual language the operator asked for coming apart.
 */

const AT = value("ut", 12_000);

function bandOf<U extends string>(
  unit: U,
  lo: number,
  v: number,
  hi: number,
  kind: "bound" | "sigma1" = "sigma1",
): UncertaintyBand<U> {
  return {
    value: value(unit, v),
    lo: value(unit, lo),
    hi: value(unit, hi),
    kind,
  };
}

/** An observed quantity, with whatever band its own model offers. */
function banded<U extends string>(
  quantity: Value<U>,
  band?: UncertaintyBand,
): Reading<Value<U>> {
  return {
    state: "observed",
    value: quantity,
    atUt: AT,
    reckoning:
      band === undefined
        ? { status: "none" }
        : {
            status: "available",
            modelled: quantity,
            basis: "linear-dead-reckoning",
            band,
          },
  };
}

/** The value's bound marks, in the order they were drawn. */
function marks(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-bound]"));
}

/** The capacity's bound marks, which live at the end of the track. */
function endMarks(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-end-bound]"),
  );
}

describe("Meter's bound marks, and the track that used to contain them", () => {
  /**
   * The defect an operator asked about (#246): a mark lived inside the track,
   * whose `overflow: hidden` clipped it, so a mark was exactly as tall as its
   * own track. Back when a meter had two track heights that made the same
   * statement about a model two pixels tall on one and six on the other. The
   * size axis is gone now, but the marks stay out of the clip: their height is
   * the track's business only if they live in it.
   *
   * The structural fix is this: a mark is NOT inside the element that clips.
   * Asserted on the DOM rather than on a computed height, because jsdom
   * computes no layout and a height assertion here would pass whatever the
   * styles said.
   */
  it("draws its marks outside the clipping track, so the track cannot shorten them", () => {
    const { container } = render(
      <Meter
        label="Stress"
        value={banded(value("ratio", 0.5), bandOf("ratio", 0.42, 0.5, 0.58))}
      />,
    );
    const meter = screen.getByRole("meter", { name: "Stress" });

    const drawn = marks(container);
    expect(drawn).toHaveLength(2);
    for (const mark of drawn) {
      expect(meter.contains(mark)).toBe(false);
    }
  });

  /**
   * The fill still belongs to the track, and must: the track's overflow is what
   * rounds the fill's ends into the pill. Only the marks moved.
   */
  it("leaves the fill inside the track it is clipped by", () => {
    const { container } = render(
      <Meter
        label="Stress"
        value={banded(value("ratio", 0.5), bandOf("ratio", 0.42, 0.5, 0.58))}
      />,
    );
    const meter = screen.getByRole("meter", { name: "Stress" });

    const fill = container.querySelector<HTMLElement>("[data-fill], div > div");
    expect(fill).not.toBeNull();
    expect(meter.children.length).toBe(1);
  });
});

describe("Meter, given a reading of a fraction", () => {
  it("draws the fraction, so an unbanded reading is the bare quantity's bar", () => {
    render(<Meter label="Stress" value={banded(value("ratio", 0.34))} />);
    const meter = screen.getByRole("meter", { name: "Stress" });
    expect(meter).toHaveAttribute("aria-valuenow", "34");
  });

  it("draws nothing extra where the model offers no band", () => {
    const { container } = render(
      <Meter label="Stress" value={banded(value("ratio", 0.34))} />,
    );
    expect(marks(container)).toHaveLength(0);
  });

  it("draws one mark per bound, at the bound's own place on the track", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={banded(value("ratio", 0.39), bandOf("ratio", 0.3, 0.39, 0.44))}
      />,
    );
    const [lo, hi] = marks(container);
    expect(lo).toHaveStyle({ left: "30%" });
    expect(hi).toHaveStyle({ left: "44%" });
  });

  it("finds the band itself, so no call site reads reckoning.band", () => {
    // The whole of what a caller passes is the reading it already holds: no
    // path, no unit, no map lookup, and nothing to get wrong per widget.
    const { container } = render(
      <Meter
        label="Dose"
        value={banded(value("ratio", 0.39), bandOf("ratio", 0.3, 0.39, 0.44))}
      />,
    );
    expect(marks(container)).toHaveLength(2);
  });

  it("pins a bound that runs off the end to the end, rather than off the track", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={banded(value("ratio", 0.95), bandOf("ratio", 0.9, 0.95, 1.2))}
      />,
    );
    const [lo, hi] = marks(container);
    expect(lo).toHaveStyle({ left: "90%" });
    expect(hi).toHaveStyle({ left: "100%" });
  });

  it("ignores a band the model wrote in some other unit", () => {
    /*
     * `bandIn` refuses to narrow it, and a meter with no band behaves exactly
     * as one whose model offered none: silence beats a percentage read as a
     * fraction.
     */
    const { container } = render(
      <Meter
        label="Dose"
        value={banded(value("ratio", 0.39), bandOf("%", 30, 39, 44))}
      />,
    );
    expect(marks(container)).toHaveLength(0);
  });

  it("says the interval and what it claims, not only draws it", () => {
    render(
      <Meter
        label="Dose"
        value={banded(value("ratio", 0.39), bandOf("ratio", 0.3, 0.39, 0.44))}
      />,
    );
    const meter = screen.getByRole("meter", { name: "Dose" });
    /*
     * Pinned whole rather than probed for its parts. This is a sentence a
     * person hears, and the parts can each be present while the sentence reads
     * as three numbers in a row.
     */
    expect(meter.getAttribute("aria-valuetext")).toBe(
      "39 percent, with bands at 30 percent and 44 percent",
    );
  });

  /*
   * The listener is the reason. A meter's `aria-valuetext` is spoken on every
   * focus and every change, and "one sigma" names the interval instead of
   * saying what it claims: someone who already knows the statistics learns
   * nothing new from it and someone who does not learns nothing at all.
   */
  it("speaks the interval in plain words, with no statistics vocabulary", () => {
    render(
      <Meter
        label="Dose"
        value={banded(value("ratio", 0.39), bandOf("ratio", 0.3, 0.39, 0.44))}
      />,
    );
    const meter = screen.getByRole("meter", { name: "Dose" });
    expect(meter.getAttribute("aria-valuetext")).not.toMatch(
      /sigma|standard deviation|standard error|confidence interval/i,
    );
  });

  it("says a hard bound's interval the same way as a sigma1 one", () => {
    render(
      <Meter
        label="Dose"
        value={banded(
          value("ratio", 0.39),
          bandOf("ratio", 0.38, 0.39, 0.4, "bound"),
        )}
      />,
    );
    const meter = screen.getByRole("meter", { name: "Dose" });
    expect(meter.getAttribute("aria-valuetext")).toBe(
      "39 percent, with bands at 38 percent and 40 percent",
    );
  });

  it("renders a reading carrying no number as absence, not as a zeroed bar", () => {
    render(
      <Meter
        label="Dose"
        value={{ state: "pending", reckoning: { status: "none" } }}
      />,
    );
    expect(screen.queryByRole("meter", { name: "Dose" })).toBeNull();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("marks a bar that is not a reading of now, the way a Unit does", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={{
          state: "stale",
          reckoning: { status: "none" },
          value: value("ratio", 0.39),
          asOfUt: AT,
          grade: "held-stale",
        }}
      />,
    );
    expect(container.querySelector("[data-not-current]")).not.toBeNull();
  });

  it("dims the fill where the figure names a grade", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={{
          state: "stale",
          reckoning: { status: "none" },
          value: value("ratio", 0.39),
          asOfUt: AT,
          grade: "held-stale",
        }}
      />,
    );
    expect(container.querySelector("[data-fill-not-current]")).not.toBeNull();
  });

  it("marks the figure itself, which is the one place the doubt is drawn", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={{
          state: "stale",
          reckoning: { status: "none" },
          value: value("ratio", 0.39),
          asOfUt: AT,
          grade: "last-before-blackout",
        }}
      />,
    );
    /*
     * The mark rather than a word: the meter says the figure is no longer a
     * reading of now by marking the figure, and the grade's own word is said
     * in `aria-valuetext` and nowhere on screen. Asserted HERE because nothing
     * else asserts the mark inside a Meter, which is how it came to be clipped
     * out of sight without a test noticing.
     */
    expect(container.querySelector("[data-not-current-mark]")).not.toBeNull();
  });

  it("dims a held reading that names no grade, and still speaks it", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={{
          state: "stale",
          reckoning: { status: "none" },
          value: value("ratio", 0.39),
          asOfUt: AT,
        }}
      />,
    );

    /*
     * A figure can stop being current without anything saying HOW, and it is
     * no more a reading of now for the silence: all three signals fire, and
     * the words are grade-neutral because there is no grade to report. The
     * failure this pins is two signals without the third, a row that reads as
     * held and carries nothing explaining why.
     */
    expect(container.querySelector("[data-fill-not-current]")).not.toBeNull();
    expect(container.querySelector("[data-not-current-mark]")).not.toBeNull();

    const at = formatQuantity(AT.magnitude, AT.unit).value;
    const caption = container.querySelector("[data-unit-currency]");
    expect(caption?.textContent).toMatch(/HELD/i);
    expect(caption?.textContent).not.toMatch(/STALE|BLACKOUT|RECORDED/i);
    expect(caption?.textContent).toContain(at);
  });

  it("says nothing at all while the figure is a reading of now", () => {
    const { container } = render(
      <Meter label="Dose" value={banded(value("ratio", 0.39))} />,
    );
    expect(container.querySelector("[data-fill-not-current]")).toBeNull();
    expect(container.querySelector("[data-not-current-mark]")).toBeNull();
  });

  it("speaks the mark it draws, because the value IS a Unit", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={{
          state: "stale",
          reckoning: { status: "none" },
          value: value("ratio", 0.39),
          asOfUt: AT,
          grade: "held-stale",
        }}
      />,
    );

    /*
     * Meter draws its value as `<Unit value={value} />`, so the dot, the
     * caption and the tooltip are all Unit's and arrive together. Asserted
     * here rather than trusted, because "it inherits it" is the kind of claim
     * that stays true until someone passes `valueLabel` instead.
     *
     * Both halves of what a held figure owes a reader are pinned: the grade
     * word, and the instant it was last a reading of now. The time is matched
     * FORMATTED rather than by a loose /as of/, because the failure worth
     * catching is a UT arriving as the null token: "as of <null>" matches the
     * words around it and says nothing, which is what `lastValidAt` refuses.
     */
    const at = formatQuantity(AT.magnitude, AT.unit).value;
    expect(at).not.toBe(NULL_DISPLAY);

    const caption = container.querySelector("[data-unit-currency]");
    expect(caption?.textContent).toMatch(/STALE/i);
    expect(caption?.textContent).toContain(at);

    // Silent by design: the words beside it are what speak.
    const mark = container.querySelector("[data-not-current-mark]");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");

    /*
     * Anchored to the marked quantity rather than the first [title] in the
     * document. `Unit` also titles the unit SYMBOL, which a `ratio` happens
     * not to render, so a document-order query passes today and would quietly
     * start testing the symbol the day one appears.
     */
    const hover = mark?.closest("[title]")?.getAttribute("title");
    expect(hover).toMatch(/STALE/i);
    expect(hover).toContain(at);
  });

  it("draws no mark and says nothing where valueLabel bypasses the Unit", () => {
    const { container } = render(
      <Meter
        label="Dose"
        valueLabel="39%"
        value={{
          state: "stale",
          reckoning: { status: "none" },
          value: value("ratio", 0.39),
          asOfUt: AT,
          grade: "held-stale",
        }}
      />,
    );

    /*
     * The property that makes inheriting safe: the dot and the words are the
     * same component's, so a call site bypassing `Unit` loses both together
     * and cannot end up with a silent dot.
     */
    expect(container.querySelector("[data-not-current-mark]")).toBeNull();
    expect(container.querySelector("[data-unit-currency]")).toBeNull();
  });

  it("leaves the band marks alone: a band is doubt, not staleness", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={{
          state: "stale",
          reckoning: {
            status: "available",
            modelled: value("ratio", 0.39),
            basis: "linear-dead-reckoning",
            band: bandOf("ratio", 0.379, 0.39, 0.401),
          },
          value: value("ratio", 0.39),
          asOfUt: AT,
          grade: "held-stale",
        }}
      />,
    );
    expect(container.querySelector("[data-fill-not-current]")).not.toBeNull();
    expect(marks(container)).toHaveLength(2);
  });

  it("has no axe violations with the marks drawn", async () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={banded(value("ratio", 0.39), bandOf("ratio", 0.3, 0.39, 0.44))}
      />,
    );
    await expectNoA11yViolations(container);
  });
});

describe("Meter, given a value and a capacity", () => {
  it("draws the two halves exactly as the bare quantities do", () => {
    render(
      <Meter
        label="LiquidFuel"
        value={banded(value("units", 232))}
        capacity={value("units", 400)}
      />,
    );
    const meter = screen.getByRole("meter", { name: "LiquidFuel" });
    expect(meter).toHaveAttribute("aria-valuenow", "58");
  });

  it("divides the value's band by the capacity, so the marks land on the same track", () => {
    const { container } = render(
      <Meter
        label="LiquidFuel"
        value={banded(value("units", 232), bandOf("units", 200, 232, 260))}
        capacity={value("units", 400)}
      />,
    );
    const [lo, hi] = marks(container);
    expect(lo).toHaveStyle({ left: "50%" });
    expect(hi).toHaveStyle({ left: "65%" });
  });

  it("draws nothing where the model banded the value in some other unit", () => {
    const { container } = render(
      <Meter
        label="LiquidFuel"
        value={banded(value("units", 232), bandOf("kg", 200, 232, 260))}
        capacity={value("units", 400)}
      />,
    );
    expect(marks(container)).toHaveLength(0);
  });
});

describe("Meter, given a capacity that is itself a reading", () => {
  /*
   * A capacity is not always a tank. A fatal threshold is one, and RP-1's
   * facility tiers move, so the axis can go stale and can carry doubt of its
   * own. These pin the three places that doubt goes, and the one place it must
   * never go.
   */
  it("marks an uncertain capacity at the END of the track, not along it", () => {
    // The end IS one whole. A capacity that might be 390 rather than 400 puts
    // the true end just inside the track, at 390/400.
    const { container } = render(
      <Meter
        label="LiquidFuel"
        value={value("units", 232)}
        capacity={banded(
          value("units", 400),
          bandOf("units", 390, 400, 410, "bound"),
        )}
      />,
    );
    const [lo, hi] = endMarks(container);
    expect(lo).toHaveStyle({ left: "97.5%" });
    expect(hi).toHaveStyle({ left: "100%" });
  });

  it("names the capacity's interval as the capacity's, in its own clause", () => {
    render(
      <Meter
        label="LiquidFuel"
        value={value("units", 232)}
        capacity={banded(
          value("units", 400),
          bandOf("units", 390, 400, 410, "bound"),
        )}
      />,
    );
    const meter = screen.getByRole("meter", { name: "LiquidFuel" });
    expect(meter.getAttribute("aria-valuetext")).toContain(
      "capacity with bands at 390",
    );
  });

  it("never merges the two intervals into one", () => {
    /*
     * #215: a fraction of an uncertain whole is uncertain twice over, and
     * combining two intervals is width arithmetic the framework may not do,
     * because it cannot know whether the errors are independent. So the two
     * bands stay four marks in two places, and the sentence stays two clauses.
     */
    const { container } = render(
      <Meter
        label="LiquidFuel"
        value={banded(value("units", 232), bandOf("units", 200, 232, 260))}
        capacity={banded(
          value("units", 400),
          bandOf("units", 390, 400, 410, "bound"),
        )}
      />,
    );
    expect(marks(container)).toHaveLength(2);
    expect(endMarks(container)).toHaveLength(2);
    const spoken = screen
      .getByRole("meter", { name: "LiquidFuel" })
      .getAttribute("aria-valuetext");
    expect(spoken).toContain("with bands at 200");
    expect(spoken).toContain("capacity with bands at 390");
  });

  it("marks the TRACK when the capacity has stopped being current", () => {
    // The axis is what aged, not the reading on it, so the fill is left alone.
    const { container } = render(
      <Meter
        label="LiquidFuel"
        value={value("units", 232)}
        capacity={{
          state: "stale",
          reckoning: { status: "none" },
          value: value("units", 400),
          asOfUt: AT,
          grade: "held-stale",
        }}
      />,
    );
    expect(container.querySelector("[data-track-not-current]")).not.toBeNull();
  });
});
