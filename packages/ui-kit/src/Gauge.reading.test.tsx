import {
  type Reading,
  type UncertaintyBand,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Gauge } from "./Gauge";
import { NULL_DISPLAY } from "./NullValue";

/**
 * The reckoning slot: what `<Gauge>` draws when it is handed a whole `Reading`
 * rather than a bare quantity.
 *
 * The same three things the meter takes off a reading, in the medium an
 * instrument draws in: whether the figure is a reading of NOW, the model's two
 * bounds, and whether there is a number at all. An instrument cannot hold a
 * span, so the mark is a tspan and the bound is a line, but a gauge and a
 * readout on one panel say the same thing the same way.
 */

const AT = value("ut", 12_000);

function bandOf<U extends string>(
  unit: U,
  lo: number,
  v: number,
  hi: number,
): UncertaintyBand<U> {
  return {
    value: value(unit, v),
    lo: value(unit, lo),
    hi: value(unit, hi),
    kind: "sigma1",
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

function bounds(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll("[data-bound]"));
}

const SIZE = { width: 160, height: 90 } as const;

describe("Gauge, handed a Reading", () => {
  it("draws an observed reading exactly as it draws the bare quantity", () => {
    const asReading = render(
      <Gauge
        {...SIZE}
        value={banded(value("1", 1.84))}
        min={value("1", 0)}
        max={value("1", 3)}
      />,
    );
    const asValue = render(
      <Gauge
        {...SIZE}
        value={value("1", 1.84)}
        min={value("1", 0)}
        max={value("1", 3)}
      />,
    );
    expect(asReading.container.innerHTML).toBe(asValue.container.innerHTML);
  });

  it("marks a figure that is not a reading of now, the way a Unit does", () => {
    const { container } = render(
      <Gauge
        {...SIZE}
        value={{
          state: "stale",
          reckoning: { status: "none" },
          value: value("1", 1.84),
          asOfUt: AT,
          grade: "held-stale",
        }}
        min={value("1", 0)}
        max={value("1", 3)}
      />,
    );
    expect(container.querySelector("[data-not-current]")).not.toBeNull();
    expect(container.querySelector("[data-not-current-mark]")).not.toBeNull();
  });

  it("says the currency in words, because the mark has none to say", () => {
    render(
      <Gauge
        {...SIZE}
        value={{
          state: "stale",
          reckoning: { status: "none" },
          value: value("1", 1.84),
          asOfUt: AT,
          grade: "held-stale",
        }}
        min={value("1", 0)}
        max={value("1", 3)}
        ariaLabel="TWR"
      />,
    );
    // The grade's own word, never rephrased here.
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(
      /^TWR, /,
    );
  });

  it("leaves a current gauge's accessible name exactly as it was", () => {
    render(
      <Gauge
        {...SIZE}
        value={banded(value("1", 1.84))}
        min={value("1", 0)}
        max={value("1", 3)}
        ariaLabel="TWR"
      />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("TWR");
  });

  it("draws one mark per bound, and never a shaded interval", () => {
    const { container } = render(
      <Gauge
        {...SIZE}
        value={banded(value("1", 1.5), bandOf("1", 1.2, 1.5, 1.8))}
        min={value("1", 0)}
        max={value("1", 3)}
      />,
    );
    expect(bounds(container)).toHaveLength(2);
    expect(bounds(container).map((b) => b.getAttribute("data-bound"))).toEqual([
      "lo",
      "hi",
    ]);
  });

  it("places the two bounds apart, at their own points on the arc", () => {
    const { container } = render(
      <Gauge
        {...SIZE}
        value={banded(value("1", 1.5), bandOf("1", 1.2, 1.5, 1.8))}
        min={value("1", 0)}
        max={value("1", 3)}
      />,
    );
    const [lo, hi] = bounds(container);
    expect(lo.getAttribute("x1")).not.toBe(hi.getAttribute("x1"));
  });

  it("draws no bound for a model that offers no band", () => {
    const { container } = render(
      <Gauge
        {...SIZE}
        value={banded(value("1", 1.5))}
        min={value("1", 0)}
        max={value("1", 3)}
      />,
    );
    expect(bounds(container)).toHaveLength(0);
  });

  it("ignores a band that arrived in another kind rather than placing it", () => {
    const { container } = render(
      <Gauge
        {...SIZE}
        value={banded(value("1", 1.5), bandOf("m", 1.2, 1.5, 1.8))}
        min={value("1", 0)}
        max={value("1", 3)}
      />,
    );
    expect(bounds(container)).toHaveLength(0);
  });

  it("shows no needle for a reading that carries no number", () => {
    const { container } = render(
      <Gauge
        {...SIZE}
        value={{ state: "pending", reckoning: { status: "none" } }}
        min={value("1", 0)}
        max={value("1", 3)}
      />,
    );
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
    // A needle parked at the bottom of the scale would be a reading of zero.
    expect(container.querySelector("line")).toBeNull();
  });

  it("has no axe violations with the mark and the bounds drawn", async () => {
    const { container } = render(
      <Gauge
        {...SIZE}
        value={{
          state: "stale",
          reckoning: {
            status: "available",
            modelled: value("1", 1.5),
            basis: "linear-dead-reckoning",
            band: bandOf("1", 1.2, 1.5, 1.8),
          },
          value: value("1", 1.5),
          asOfUt: AT,
          grade: "held-stale",
        }}
        min={value("1", 0)}
        max={value("1", 3)}
        ariaLabel="TWR"
      />,
    );
    await expectNoA11yViolations(container);
  });
});

describe("Gauge hover title", () => {
  it("says what the accessible name says, not a bare magnitude", () => {
    const { container } = render(
      <Gauge
        min={value("1", 0)}
        max={value("1", 3)}
        width={120}
        height={80}
        value={{ state: "pending", reckoning: { status: "none" } }}
      />,
    );
    const svg = container.querySelector("svg[role='img']");
    expect(svg?.querySelector("title")?.textContent).toBe(
      svg?.getAttribute("aria-label"),
    );
  });
});
