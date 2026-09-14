import {
  type Reading,
  type ReckonedBands,
  type UncertaintyBand,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Meter, type MeterQuantity } from "./Meter";
import { NULL_DISPLAY } from "./NullValue";

/**
 * The reckoning slot: what `<Meter>` draws when it is handed a whole `Reading`
 * rather than a bare fraction or a bare pair.
 *
 * Two things come off the reading and only two: whether the bar is a reading of
 * NOW, which it draws the way `<Unit>` does, and the band, which it draws as one
 * mark per bound on its own track. The band LOOKUP is what these tests pin to
 * the primitive: a call site that had to reach `reckoned.bands` itself would be
 * deciding both what an absent map means and what unit the interval arrived in,
 * and sixty widgets deciding that separately is the visual language the operator
 * asked for coming apart.
 */

const AT = value("ut", 12_000);

function ratioBand(
  lo: number,
  v: number,
  hi: number,
  kind: "bound" | "sigma1" = "sigma1",
): UncertaintyBand {
  return {
    value: value("ratio", v),
    lo: value("ratio", lo),
    hi: value("ratio", hi),
    kind,
  };
}

/** An observed fraction, with whatever bands the model offers at the root. */
function bandedFraction(v: number, bands?: ReckonedBands): Reading<number> {
  if (!bands) {
    return { state: "observed", reckoning: "none", value: v, atUt: AT };
  }
  return {
    state: "observed",
    reckoning: "available",
    value: v,
    atUt: AT,
    reckoned: {
      value: v,
      atUt: AT,
      basis: "linear-dead-reckoning",
      modelled: [{ path: "", basis: "linear-dead-reckoning" }],
      owner: "core",
      bands,
    },
  };
}

/** A pair, with whatever bands the model offers about its `amount`. */
function bandedPair(
  amount: number,
  capacity: number,
  bands?: ReckonedBands,
): Reading<MeterQuantity<"units">> {
  const pair: MeterQuantity<"units"> = {
    amount: value("units", amount),
    capacity: value("units", capacity),
  };
  if (!bands) {
    return { state: "observed", reckoning: "none", value: pair, atUt: AT };
  }
  return {
    state: "observed",
    reckoning: "available",
    value: pair,
    atUt: AT,
    reckoned: {
      value: pair,
      atUt: AT,
      basis: "linear-dead-reckoning",
      modelled: [{ path: "amount", basis: "linear-dead-reckoning" }],
      owner: "core",
      bands,
    },
  };
}

/** The bound marks on the one meter rendered, in the order they were drawn. */
function marks(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-bound]"));
}

describe("Meter, given a reading of a fraction", () => {
  it("draws the fraction, so an unbanded reading is the bare number's bar", () => {
    render(<Meter label="Stress" value={bandedFraction(0.34)} />);
    const meter = screen.getByRole("meter", { name: "Stress" });
    expect(meter).toHaveAttribute("aria-valuenow", "34");
  });

  it("draws nothing extra where the model offers no band", () => {
    const { container } = render(
      <Meter label="Stress" value={bandedFraction(0.34)} />,
    );
    expect(marks(container)).toHaveLength(0);
  });

  it("draws one mark per bound, at the bound's own place on the track", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={bandedFraction(0.39, { "": ratioBand(0.3, 0.39, 0.44) })}
      />,
    );
    const [lo, hi] = marks(container);
    expect(lo).toHaveStyle({ left: "30%" });
    expect(hi).toHaveStyle({ left: "44%" });
  });

  it("finds the band itself, so no call site reads reckoned.bands", () => {
    // The whole of what a caller passes is the reading it already holds: no
    // path, no unit, no map lookup, and nothing to get wrong per widget.
    const { container } = render(
      <Meter
        label="Dose"
        value={bandedFraction(0.39, { "": ratioBand(0.3, 0.39, 0.44) })}
      />,
    );
    expect(marks(container)).toHaveLength(2);
  });

  it("pins a bound that runs off the end to the end, rather than off the track", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={bandedFraction(0.95, { "": ratioBand(0.9, 0.95, 1.2) })}
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
        value={bandedFraction(0.39, {
          "": {
            value: value("%", 39),
            lo: value("%", 30),
            hi: value("%", 44),
            kind: "sigma1",
          },
        })}
      />,
    );
    expect(marks(container)).toHaveLength(0);
  });

  it("says the interval and what it claims, not only draws it", () => {
    render(
      <Meter
        label="Dose"
        value={bandedFraction(0.39, { "": ratioBand(0.3, 0.39, 0.44) })}
      />,
    );
    const meter = screen.getByRole("meter", { name: "Dose" });
    /*
     * Pinned whole rather than probed for its parts. This is a sentence a
     * person hears, and the parts can each be present while the sentence reads
     * as three numbers in a row.
     */
    expect(meter.getAttribute("aria-valuetext")).toBe(
      "39 percent, between 30 percent and 44 percent about two thirds of the time",
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
        value={bandedFraction(0.39, { "": ratioBand(0.3, 0.39, 0.44) })}
      />,
    );
    const meter = screen.getByRole("meter", { name: "Dose" });
    expect(meter.getAttribute("aria-valuetext")).not.toMatch(
      /sigma|standard deviation|standard error|confidence interval/i,
    );
  });

  it("leaves a hard bound unqualified, which is the stronger claim", () => {
    render(
      <Meter
        label="Dose"
        value={bandedFraction(0.39, {
          "": ratioBand(0.38, 0.39, 0.4, "bound"),
        })}
      />,
    );
    const meter = screen.getByRole("meter", { name: "Dose" });
    expect(meter.getAttribute("aria-valuetext")).toBe(
      "39 percent, between 38 percent and 40 percent",
    );
  });

  it("renders a reading carrying no number as absence, not as a zeroed bar", () => {
    render(
      <Meter
        label="Dose"
        value={{ state: "pending", reckoning: "none" } as Reading<number>}
      />,
    );
    expect(screen.queryByRole("meter", { name: "Dose" })).toBeNull();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("marks a bar that is not a reading of now, the way a Unit does", () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={
          {
            state: "stale",
            reckoning: "none",
            value: 0.39,
            asOfUt: AT,
            grade: "held-stale",
          } as Reading<number>
        }
      />,
    );
    expect(container.querySelector("[data-not-current]")).not.toBeNull();
  });

  it("has no axe violations with the marks drawn", async () => {
    const { container } = render(
      <Meter
        label="Dose"
        value={bandedFraction(0.39, { "": ratioBand(0.3, 0.39, 0.44) })}
      />,
    );
    await expectNoA11yViolations(container);
  });
});

describe("Meter, given a reading of a pair", () => {
  it("draws the pair exactly as the bare pair does", () => {
    render(<Meter label="LiquidFuel" quantity={bandedPair(232, 400)} />);
    const meter = screen.getByRole("meter", { name: "LiquidFuel" });
    expect(meter).toHaveAttribute("aria-valuenow", "58");
  });

  it("divides the band by the capacity, so the marks land on the same track", () => {
    const { container } = render(
      <Meter
        label="LiquidFuel"
        quantity={bandedPair(232, 400, {
          amount: {
            value: value("units", 232),
            lo: value("units", 200),
            hi: value("units", 260),
            kind: "sigma1",
          },
        })}
      />,
    );
    const [lo, hi] = marks(container);
    expect(lo).toHaveStyle({ left: "50%" });
    expect(hi).toHaveStyle({ left: "65%" });
  });

  it("draws nothing where the model banded some other field of the pair", () => {
    const { container } = render(
      <Meter
        label="LiquidFuel"
        quantity={bandedPair(232, 400, {
          capacity: {
            value: value("units", 400),
            lo: value("units", 390),
            hi: value("units", 410),
            kind: "bound",
          },
        })}
      />,
    );
    expect(marks(container)).toHaveLength(0);
  });
});
