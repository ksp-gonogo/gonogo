import {
  type Reading,
  type UncertaintyBand,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Dial } from "./Dial";
import { Gauge } from "./Gauge";
import { BAND_MARK_TOLERANCE } from "./instrumentCurrency";
import { Meter } from "./Meter";
import { Tape } from "./Tape";

/**
 * Band marks are drawn only where the model sits visibly away from the
 * observation, on every primitive that draws them, and for a live reading and a
 * held one alike. Every scale below runs 0 to 100, so a bound's distance from
 * the observation in units is its distance in percent of the scale.
 */

const AT = value("ut", 12_000);

function bandOf<U extends string>(
  unit: U,
  lo: number,
  hi: number,
): UncertaintyBand<U> {
  return {
    value: value(unit, (lo + hi) / 2),
    lo: value(unit, lo),
    hi: value(unit, hi),
    kind: "sigma1",
  };
}

function reading<U extends string>(
  state: "observed" | "stale",
  quantity: Value<U>,
  band: UncertaintyBand<U>,
): Reading<Value<U>> {
  const reckoning = {
    status: "available",
    modelled: band.value,
    basis: "rate-integration",
    band,
  } as const;
  return state === "observed"
    ? { state, value: quantity, atUt: AT, reckoning }
    : { state, value: quantity, asOfUt: AT, grade: "held-stale", reckoning };
}

/** Bounds 0.4 % either side of 50, inside a one-percent tolerance, and 3 % and 5 % above it, well outside it. */
const WITHIN = [49.6, 50.4];
const APART = [53, 55];

const marks = (container: HTMLElement) =>
  container.querySelectorAll("[data-bound]");

const cases = [
  {
    name: "Meter",
    draw: (r: Reading<Value<"%">>) => (
      <Meter label="Dose" value={r} capacity={value("%", 100)} />
    ),
  },
  {
    name: "Gauge",
    draw: (r: Reading<Value<"%">>) => (
      <Gauge
        width={160}
        height={90}
        value={r}
        min={value("%", 0)}
        max={value("%", 100)}
      />
    ),
  },
  {
    name: "Dial",
    draw: (r: Reading<Value<"%">>) => (
      <Dial value={r} min={value("%", 0)} max={value("%", 100)} />
    ),
  },
  {
    name: "Tape",
    draw: (r: Reading<Value<"%">>) => (
      <Tape value={r} min={value("%", 0)} max={value("%", 100)} />
    ),
  },
] as const;

describe.each(cases)("$name's band marks", ({ draw }) => {
  for (const state of ["observed", "stale"] as const) {
    it(`hides them on a${state === "observed" ? " live" : " held"} reading the model agrees with`, () => {
      const [lo, hi] = WITHIN;
      const { container } = render(
        draw(reading(state, value("%", 50), bandOf("%", lo, hi))),
      );
      expect(marks(container)).toHaveLength(0);
    });

    it(`draws them on a${state === "observed" ? " live" : " held"} reading the model has moved away from`, () => {
      const [lo, hi] = APART;
      const { container } = render(
        draw(reading(state, value("%", 50), bandOf("%", lo, hi))),
      );
      expect(marks(container)).toHaveLength(2);
    });
  }

  it("draws both when only one bound stands apart", () => {
    const { container } = render(
      draw(reading("observed", value("%", 50), bandOf("%", 50, 53))),
    );
    expect(marks(container)).toHaveLength(2);
  });
});

describe("the tolerance", () => {
  it("is one percent of the scale", () => {
    expect(BAND_MARK_TOLERANCE).toBe(0.01);
  });

  it("drops the spoken bands with the hidden marks, so the two readers agree", () => {
    const [lo, hi] = WITHIN;
    render(
      <Meter
        label="Dose"
        value={reading("observed", value("%", 50), bandOf("%", lo, hi))}
        capacity={value("%", 100)}
      />,
    );
    expect(
      screen
        .getByRole("meter", { name: "Dose" })
        .getAttribute("aria-valuetext"),
    ).not.toContain("bands");
  });

  it("hides a capacity's end marks where they sit on the track's end", () => {
    const { container } = render(
      <Meter
        label="Fuel"
        value={value("units", 40)}
        capacity={reading(
          "observed",
          value("units", 100),
          bandOf("units", 99.5, 100.4),
        )}
      />,
    );
    expect(container.querySelectorAll("[data-end-bound]")).toHaveLength(0);
  });
});
