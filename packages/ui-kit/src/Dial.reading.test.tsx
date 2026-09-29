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
 * What `<Dial>` draws when it is handed a whole `Reading` rather than a bare
 * quantity.
 */

const AT = value("ut", 12_000);

function bandOf<Unit extends string>(unit: Unit, lo: number, hi: number) {
  return {
    value: value(unit, (lo + hi) / 2),
    lo: value(unit, lo),
    hi: value(unit, hi),
    kind: "sigma1",
  } as UncertaintyBand<Unit>;
}

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

function held<Unit extends string>(
  quantity: Value<Unit>,
): Reading<Value<Unit>> {
  return {
    state: "held",
    reckoning: { status: "none" },
    value: quantity,
    asOfUt: AT,
    grade: "held",
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
    expect(container.querySelector("[data-held]")).not.toBeNull();
    expect(container.querySelector("[data-held-mark]")).not.toBeNull();
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
          state: "held",
          reckoning: {
            status: "available",
            atUt: value("ut", 0),
            beyondReceived: false,
            modelled: value("deg", 90),
            basis: "linear-dead-reckoning",
            band: bandOf("deg", 60, 120),
          },
          value: value("deg", 90),
          asOfUt: AT,
          grade: "held",
        }}
        ariaLabel="Heading"
      />,
    );
    await expectNoA11yViolations(container);
  });
});

describe("Dial with no figure", () => {
  it("is not announced as a meter reading the bottom of its scale", async () => {
    const { container } = render(
      <Dial
        {...AXIS}
        value={{ state: "pending", reckoning: { status: "none" } }}
        ariaLabel="Heading"
      />,
    );
    expect(screen.queryByRole("meter")).toBeNull();
    expect(
      screen.getByRole("img", { name: `Heading: ${NULL_DISPLAY}` }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
