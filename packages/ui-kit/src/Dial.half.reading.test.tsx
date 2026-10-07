import {
  type Reading,
  type UncertaintyBand,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Dial } from "./Dial";
import { NULL_DISPLAY } from "./NullValue";

/**
 * The reckoning slot: what `<Dial startAngle={-90} sweep={180} readout="regular">` draws when it is handed a whole `Reading`
 * rather than a bare quantity: whether the figure is current, the model's two
 * bounds, and whether there is a number at all.
 */

const AT = value("ut", 12_000);

function bandOf<Unit extends string>(
  unit: Unit,
  lo: number,
  v: number,
  hi: number,
): UncertaintyBand<Unit> {
  return {
    value: value(unit, v),
    lo: value(unit, lo),
    hi: value(unit, hi),
    kind: "sigma1",
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

function bounds(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll("[data-bound]"));
}

const SIZE = { width: 160, height: 90 } as const;

describe("Gauge, handed a Reading", () => {
  it("draws an observed reading exactly as it draws the bare quantity", () => {
    const asReading = render(
      <Dial
        aria-label="Dial"
        startAngle={-90}
        sweep={180}
        readout="regular"
        {...SIZE}
        value={banded(value("1", 1.84))}
        min={value("1", 0)}
        max={value("1", 3)}
      />,
    );
    const asValue = render(
      <Dial
        aria-label="Dial"
        startAngle={-90}
        sweep={180}
        readout="regular"
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
      <Dial
        aria-label="Dial"
        startAngle={-90}
        sweep={180}
        readout="regular"
        {...SIZE}
        value={{
          state: "held",
          reckoning: { status: "none" },
          value: value("1", 1.84),
          asOfUt: AT,
          grade: "held",
        }}
        min={value("1", 0)}
        max={value("1", 3)}
      />,
    );
    expect(container.querySelector("[data-held]")).not.toBeNull();
    expect(container.querySelector("[data-held-mark]")).not.toBeNull();
  });

  it("raises the held mark to the top of the figure's digits, at either readout size", () => {
    const raise = (readout: "regular" | "large") => {
      const { container } = render(
        <Dial
          aria-label="Dial"
          startAngle={-90}
          sweep={180}
          readout={readout}
          {...SIZE}
          value={{
            state: "held",
            reckoning: { status: "none" },
            value: value("1", 1.84),
            asOfUt: AT,
            grade: "held",
          }}
          min={value("1", 0)}
          max={value("1", 3)}
        />,
      );
      const mark = container.querySelector("[data-held-mark]");
      const figure = mark?.closest("text");
      return {
        dy: -Number(mark?.getAttribute("dy")),
        figure: Number(figure?.getAttribute("font-size")),
        mark: Number(mark?.getAttribute("font-size")),
      };
    };
    for (const readout of ["regular", "large"] as const) {
      const { dy, figure, mark } = raise(readout);
      // The mark's top (its raise plus its own height) is within a pixel and a half of the digits' top, 0.72 of the figure's size. A fixed raise of half the mark left it on the baseline of a large figure.
      expect(Math.abs(dy + mark * 0.76 - figure * 0.72)).toBeLessThan(1.5);
      expect(dy).toBeGreaterThan(figure * 0.35);
    }
  });

  it("says the currency in words, because the mark has none to say", () => {
    render(
      <Dial
        startAngle={-90}
        sweep={180}
        readout="regular"
        {...SIZE}
        value={{
          state: "held",
          reckoning: { status: "none" },
          value: value("1", 1.84),
          asOfUt: AT,
          grade: "held",
        }}
        min={value("1", 0)}
        max={value("1", 3)}
        aria-label="TWR"
      />,
    );
    // The grade's own word, never rephrased here.
    expect(screen.getByRole("meter").getAttribute("aria-label")).toMatch(
      /^TWR, /,
    );
  });

  it("leaves a current gauge's accessible name exactly as it was", () => {
    render(
      <Dial
        startAngle={-90}
        sweep={180}
        readout="regular"
        {...SIZE}
        value={banded(value("1", 1.84))}
        min={value("1", 0)}
        max={value("1", 3)}
        aria-label="TWR"
      />,
    );
    expect(screen.getByRole("meter").getAttribute("aria-label")).toBe("TWR");
  });

  it("draws one mark per bound, and never a shaded interval", () => {
    const { container } = render(
      <Dial
        aria-label="Dial"
        startAngle={-90}
        sweep={180}
        readout="regular"
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
      <Dial
        aria-label="Dial"
        startAngle={-90}
        sweep={180}
        readout="regular"
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
      <Dial
        aria-label="Dial"
        startAngle={-90}
        sweep={180}
        readout="regular"
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
      <Dial
        aria-label="Dial"
        startAngle={-90}
        sweep={180}
        readout="regular"
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
      <Dial
        aria-label="Dial"
        startAngle={-90}
        sweep={180}
        readout="regular"
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
      <Dial
        startAngle={-90}
        sweep={180}
        readout="regular"
        {...SIZE}
        value={{
          state: "held",
          reckoning: {
            status: "available",
            atUt: value("ut", 0),
            beyondReceived: false,
            modelled: value("1", 1.5),
            basis: "linear-dead-reckoning",
            band: bandOf("1", 1.2, 1.5, 1.8),
          },
          value: value("1", 1.5),
          asOfUt: AT,
          grade: "held",
        }}
        min={value("1", 0)}
        max={value("1", 3)}
        aria-label="TWR"
      />,
    );
    await expectNoA11yViolations(container);
  });
});

describe("Gauge hover title", () => {
  it("says what the accessible name says, not a bare magnitude", () => {
    const { container } = render(
      <Dial
        aria-label="Dial"
        startAngle={-90}
        sweep={180}
        readout="regular"
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
