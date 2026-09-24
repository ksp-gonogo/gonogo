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
 * The reckoning slot: what `<Dial>` draws when it is handed a whole `Reading`
 * rather than a bare quantity. The face's own version of the three statements
 * every instrument takes off a reading.
 */

const AT = value("ut", 12_000);

function bandOf<U extends string>(unit: U, lo: number, hi: number) {
  return {
    value: value(unit, (lo + hi) / 2),
    lo: value(unit, lo),
    hi: value(unit, hi),
    kind: "sigma1",
  } as UncertaintyBand<U>;
}

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

function held<U extends string>(quantity: Value<U>): Reading<Value<U>> {
  return {
    state: "stale",
    reckoning: { status: "none" },
    value: quantity,
    asOfUt: AT,
    grade: "held-stale",
  };
}

const AXIS = { min: value("deg", 0), max: value("deg", 360) } as const;

describe("Dial, handed a Reading", () => {
  it("draws an observed reading exactly as it draws the bare quantity", () => {
    const asReading = render(
      <Dial {...AXIS} value={banded(value("deg", 90))} ariaLabel="Heading" />,
    );
    const asValue = render(
      <Dial {...AXIS} value={value("deg", 90)} ariaLabel="Heading" />,
    );
    expect(asReading.container.innerHTML).toBe(asValue.container.innerHTML);
  });

  it("marks a centre readout that is not a reading of now", () => {
    const { container } = render(
      <Dial {...AXIS} value={held(value("deg", 90))} ariaLabel="Heading" />,
    );
    expect(container.querySelector("[data-not-current]")).not.toBeNull();
    expect(container.querySelector("[data-not-current-mark]")).not.toBeNull();
  });

  it("says the currency on the face's own accessible name", () => {
    render(
      <Dial {...AXIS} value={held(value("deg", 90))} ariaLabel="Heading" />,
    );
    expect(screen.getByRole("meter").getAttribute("aria-label")).toMatch(
      /^Heading, /,
    );
  });

  it("leaves a current face's accessible name exactly as it was", () => {
    render(
      <Dial {...AXIS} value={banded(value("deg", 90))} ariaLabel="Heading" />,
    );
    expect(screen.getByRole("meter").getAttribute("aria-label")).toBe(
      "Heading",
    );
  });

  it("draws one mark per bound, at its own angle on the face", () => {
    const { container } = render(
      <Dial
        {...AXIS}
        value={banded(value("deg", 90), bandOf("deg", 60, 120))}
        ariaLabel="Heading"
      />,
    );
    const marks = Array.from(container.querySelectorAll("[data-bound]"));
    expect(marks).toHaveLength(2);
    expect(marks[0].getAttribute("x1")).not.toBe(marks[1].getAttribute("x1"));
  });

  it("ignores a band that arrived in another kind rather than placing it", () => {
    const { container } = render(
      <Dial
        {...AXIS}
        value={banded(value("deg", 90), bandOf("m", 60, 120))}
        ariaLabel="Heading"
      />,
    );
    expect(container.querySelectorAll("[data-bound]")).toHaveLength(0);
  });

  it("shows no needle for a reading that carries no number", () => {
    const { container } = render(
      <Dial
        {...AXIS}
        value={{ state: "pending", reckoning: { status: "none" } }}
        ariaLabel="Heading"
      />,
    );
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
    expect(container.querySelectorAll("line")).toHaveLength(0);
  });

  it("has no axe violations with the mark and the bounds drawn", async () => {
    const { container } = render(
      <Dial
        {...AXIS}
        value={{
          state: "stale",
          reckoning: {
            status: "available",
            modelled: value("deg", 90),
            basis: "linear-dead-reckoning",
            band: bandOf("deg", 60, 120),
          },
          value: value("deg", 90),
          asOfUt: AT,
          grade: "held-stale",
        }}
        ariaLabel="Heading"
      />,
    );
    await expectNoA11yViolations(container);
  });
});
