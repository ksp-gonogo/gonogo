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
import { emittedRuleFor } from "./test/emittedRule";
import { formatQuantity } from "./units";

/**
 * The reckoning slot: what `<Meter>` draws when it is handed a whole `Reading`
 * rather than a bare quantity: whether the bar is a reading of now, the value's
 * band as one mark per bound, and the capacity's band at the track's end. The
 * two bands are never merged.
 */

const AT = value("ut", 12_000);

function bandOf<Unit extends string>(
  unit: Unit,
  lo: number,
  v: number,
  hi: number,
  kind: "bound" | "sigma1" = "sigma1",
): UncertaintyBand<Unit> {
  return {
    value: value(unit, v),
    lo: value(unit, lo),
    hi: value(unit, hi),
    kind,
  };
}

/** An observed quantity, with whatever band its own model offers. */
function banded<Unit extends string>(
  quantity: Value<Unit>,
  band?: UncertaintyBand,
): Reading<Value<Unit>> {
  return {
    state: "observed",
    value: quantity,
    atUt: AT,
    reckoning:
      band === undefined
        ? { status: "none" }
        : {
            status: "available",
            atUt: value("ut", 0),
            beyondReceived: false,
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
  /** A mark is not inside the element that clips. Asserted on the DOM, since jsdom computes no heights. */
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

  /** The fill stays inside the track, whose overflow rounds its ends into the pill. */
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
    // A caller passes only the reading it already holds.
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
    // `bandIn` refuses to narrow it, so the meter behaves as one whose model offered no band.
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
    // Pinned whole: the parts can each be present while the sentence reads as three numbers in a row.
    expect(meter.getAttribute("aria-valuetext")).toBe(
      "39 percent, with bands at 30 percent and 44 percent",
    );
  });

  // `aria-valuetext` is spoken on every focus and change, and "one sigma" names the interval without saying what it claims.
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
          state: "held",
          reckoning: { status: "none" },
          value: value("ratio", 0.39),
          asOfUt: AT,
          grade: "held",
        }}
      />,
    );
    expect(container.querySelector("[data-held]")).not.toBeNull();
  });

  it("dims the fill where the figure names a grade", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={{
          state: "held",
          reckoning: { status: "none" },
          value: value("ratio", 0.39),
          asOfUt: AT,
          grade: "held",
        }}
      />,
    );
    expect(container.querySelector("[data-fill-held]")).not.toBeNull();
  });

  it("marks the figure itself, which is the one place the doubt is drawn", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={{
          state: "held",
          reckoning: { status: "none" },
          value: value("ratio", 0.39),
          asOfUt: AT,
          grade: "last-before-blackout",
        }}
      />,
    );
    // The figure carries the mark; the grade's word is only in `aria-valuetext`.
    expect(container.querySelector("[data-held-mark]")).not.toBeNull();
  });

  it("dims a held reading that names no grade, and still speaks it", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={{
          state: "held",
          reckoning: { status: "none" },
          value: value("ratio", 0.39),
          asOfUt: AT,
        }}
      />,
    );

    // A held figure with no named grade still fires all three signals, and says HELD.
    expect(container.querySelector("[data-fill-held]")).not.toBeNull();
    expect(container.querySelector("[data-held-mark]")).not.toBeNull();

    const at = formatQuantity(AT.magnitude, AT.unit).value;
    const caption = container.querySelector("[data-unit-currency]");
    expect(caption?.textContent).toMatch(/HELD/);
    expect(caption?.textContent).not.toMatch(/OFFLINE|BLACKOUT|RECORDED/);
    expect(caption?.textContent).toContain(at);
  });

  it("says nothing at all while the figure is a reading of now", () => {
    const { container } = render(
      <Meter label="Dose" value={banded(value("ratio", 0.39))} />,
    );
    expect(container.querySelector("[data-fill-held]")).toBeNull();
    expect(container.querySelector("[data-held-mark]")).toBeNull();
  });

  it("speaks the mark it draws, because the value IS a Unit", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={{
          state: "held",
          reckoning: { status: "none" },
          value: value("ratio", 0.39),
          asOfUt: AT,
          grade: "held",
        }}
      />,
    );

    /*
     * The dot, caption and tooltip are Unit's and arrive together. The time is
     * matched formatted, since "as of <null>" would pass a loose /as of/.
     */
    const at = formatQuantity(AT.magnitude, AT.unit).value;
    expect(at).not.toBe(NULL_DISPLAY);

    const caption = container.querySelector("[data-unit-currency]");
    expect(caption?.textContent).toMatch(/HELD/);
    expect(caption?.textContent).toContain(at);

    // Silent by design: the words beside it are what speak.
    const mark = container.querySelector("[data-held-mark]");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");

    // Anchored to the marked quantity, since `Unit` also titles the unit symbol.
    const hover = mark?.closest("[data-tooltip]")?.getAttribute("data-tooltip");
    expect(hover).toMatch(/HELD/);
    expect(hover).toContain(at);
  });

  it("keeps the held mark and says it after a caller's own valueLabel", () => {
    const { container } = render(
      <Meter
        label="Dose"
        valueLabel="39%"
        value={{
          state: "held",
          reckoning: { status: "none" },
          value: value("ratio", 0.39),
          asOfUt: AT,
          grade: "held",
        }}
      />,
    );

    // A caller's label replaces the figure, never its currency.
    const mark = container.querySelector("[data-held-mark]");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    const caption = container.querySelector("[data-unit-currency]");
    expect(caption?.textContent).toMatch(/HELD/);
    expect(container.textContent).toContain("39%");
    expect(
      screen
        .getByRole("meter", { name: "Dose" })
        .getAttribute("aria-valuetext"),
    ).toMatch(/^39%, .*HELD/);
  });

  it("says a held capacity after a caller's own valueLabel", () => {
    const { container } = render(
      <Meter
        label="Tank"
        valueLabel="half"
        value={value("t", 1)}
        capacity={{
          state: "held",
          reckoning: { status: "none" },
          value: value("t", 2),
          asOfUt: AT,
          grade: "held",
        }}
      />,
    );
    expect(container.querySelector("[data-held-mark]")).not.toBeNull();
    expect(
      container.querySelector("[data-unit-currency]")?.textContent,
    ).toMatch(/HELD/);
  });

  it("draws a caller's valueLabelNode as given, since its own Units mark themselves", () => {
    const { container } = render(
      <Meter
        label="Dose"
        valueLabel="39%"
        valueLabelNode={<span>39 percent</span>}
        value={{
          state: "held",
          reckoning: { status: "none" },
          value: value("ratio", 0.39),
          asOfUt: AT,
          grade: "held",
        }}
      />,
    );
    expect(container.querySelector("[data-held-mark]")).toBeNull();
    expect(
      screen
        .getByRole("meter", { name: "Dose" })
        .getAttribute("aria-valuetext"),
    ).toMatch(/^39%, .*HELD/);
  });

  it("adds nothing to a caller's valueLabel while the reading is current", () => {
    const { container } = render(
      <Meter label="Dose" valueLabel="39%" value={value("ratio", 0.39)} />,
    );
    expect(container.querySelector("[data-held-mark]")).toBeNull();
    expect(container.querySelector("[data-unit-currency]")).toBeNull();
  });

  it("leaves the band marks alone: a band is doubt, not staleness", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={{
          state: "held",
          reckoning: {
            status: "available",
            atUt: value("ut", 0),
            beyondReceived: false,
            modelled: value("ratio", 0.39),
            basis: "linear-dead-reckoning",
            band: bandOf("ratio", 0.379, 0.39, 0.401),
          },
          value: value("ratio", 0.39),
          asOfUt: AT,
          grade: "held",
        }}
      />,
    );
    expect(container.querySelector("[data-fill-held]")).not.toBeNull();
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
  it("marks an uncertain capacity at the END of the track, not along it", () => {
    // A capacity that might be 390 rather than 400 puts the true end just inside the track.
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
    // Whether the errors are independent is unknown, so the bands stay four marks in two places and two clauses.
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
          state: "held",
          reckoning: { status: "none" },
          value: value("units", 400),
          asOfUt: AT,
          grade: "held",
        }}
      />,
    );
    expect(container.querySelector("[data-track-held]")).not.toBeNull();
  });

  it("dashes a held track in the held mark's hue, not the 1.4:1 subtle border", () => {
    const { container } = render(
      <Meter
        label="LiquidFuel"
        value={value("units", 232)}
        capacity={{
          state: "held",
          reckoning: { status: "none" },
          value: value("units", 400),
          asOfUt: AT,
          grade: "held",
        }}
      />,
    );
    const track = container.querySelector("[data-track-held]") as HTMLElement;
    const rule = emittedRuleFor(track);
    expect(rule).toContain("dashed var(--color-status-warning-bg)");
    expect(rule).not.toContain("--color-border-subtle");
  });
});

describe("Meter absence at the edges", () => {
  it("draws a figure that is not a finite number as absence, not as an empty bar", () => {
    render(<Meter label="Dose" value={value("ratio", Number.NaN)} />);
    expect(screen.queryByRole("meter", { name: "Dose" })).toBeNull();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });
});
