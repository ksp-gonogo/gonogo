import {
  type Reading,
  type UncertaintyBand,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Tape } from "./Tape";

/**
 * The reckoning slot: what `<Tape>` draws when it is handed a whole `Reading`
 * rather than a bare quantity. The rail's own version of the three statements
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

const AXIS = { min: value("m", 0), max: value("m", 1000) } as const;

describe("Tape, handed a Reading", () => {
  it("draws an observed reading exactly as it draws the bare quantity", () => {
    const asReading = render(
      <Tape {...AXIS} value={banded(value("m", 420))} ariaLabel="AGL" />,
    );
    const asValue = render(
      <Tape {...AXIS} value={value("m", 420)} ariaLabel="AGL" />,
    );
    expect(asReading.container.innerHTML).toBe(asValue.container.innerHTML);
  });

  it("marks a pointer flag that is not a reading of now", () => {
    const { container } = render(
      <Tape {...AXIS} value={held(value("m", 420))} ariaLabel="AGL" />,
    );
    expect(container.querySelector("[data-not-current]")).not.toBeNull();
    expect(container.querySelector("[data-not-current-mark]")).not.toBeNull();
  });

  it("says the currency on the rail's own accessible name", () => {
    render(<Tape {...AXIS} value={held(value("m", 420))} ariaLabel="AGL" />);
    expect(screen.getByRole("meter").getAttribute("aria-label")).toMatch(
      /^AGL, /,
    );
  });

  it("leaves a current rail's accessible name exactly as it was", () => {
    render(<Tape {...AXIS} value={banded(value("m", 420))} ariaLabel="AGL" />);
    expect(screen.getByRole("meter").getAttribute("aria-label")).toBe("AGL");
  });

  it("draws one mark per bound, at its own height on the rail", () => {
    const { container } = render(
      <Tape
        {...AXIS}
        value={banded(value("m", 500), bandOf("m", 400, 600))}
        ariaLabel="AGL"
      />,
    );
    const marks = Array.from(container.querySelectorAll("[data-bound]"));
    expect(marks).toHaveLength(2);
    expect(marks[0].getAttribute("y1")).not.toBe(marks[1].getAttribute("y1"));
  });

  it("ignores a band that arrived in another kind rather than placing it", () => {
    const { container } = render(
      <Tape
        {...AXIS}
        value={banded(value("m", 500), bandOf("s", 400, 600))}
        ariaLabel="AGL"
      />,
    );
    expect(container.querySelectorAll("[data-bound]")).toHaveLength(0);
  });

  it("shows no pointer for a reading that carries no number", () => {
    const { container } = render(
      <Tape
        {...AXIS}
        value={{ state: "pending", reckoning: { status: "none" } }}
        ariaLabel="AGL"
      />,
    );
    // The track rect survives; what goes is the pointer line across it.
    expect(container.querySelectorAll("line")).toHaveLength(0);
  });

  it("has no axe violations with the mark and the bounds drawn", async () => {
    const { container } = render(
      <Tape
        {...AXIS}
        value={{
          state: "stale",
          reckoning: {
            status: "available",
            modelled: value("m", 500),
            basis: "linear-dead-reckoning",
            band: bandOf("m", 400, 600),
          },
          value: value("m", 500),
          asOfUt: AT,
          grade: "held-stale",
        }}
        ariaLabel="AGL"
      />,
    );
    await expectNoA11yViolations(container);
  });
});
