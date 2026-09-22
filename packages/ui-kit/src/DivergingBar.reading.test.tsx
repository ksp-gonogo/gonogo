import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { DivergingBar } from "./DivergingBar";

/**
 * The reckoning slot: what `<DivergingBar>` draws when it is handed a whole
 * `Reading`.
 *
 * Less than the other instruments draw, deliberately. The bar is decorative and
 * `aria-hidden`, so its whole treatment is to FADE, and the number beside it is
 * where the currency is stated in the ways a reader can reach.
 */

const AT = value("ut", 12_000);

function observed<U extends string>(quantity: Value<U>): Reading<Value<U>> {
  return {
    state: "observed",
    value: quantity,
    atUt: AT,
    reckoning: { status: "none" },
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

const SCALE = value("units/s", 10);

describe("DivergingBar, handed a Reading", () => {
  it("draws an observed reading exactly as it draws the bare quantity", () => {
    const asReading = render(
      <DivergingBar value={observed(value("units/s", 4))} maxAbs={SCALE} />,
    );
    const asValue = render(
      <DivergingBar value={value("units/s", 4)} maxAbs={SCALE} />,
    );
    expect(asReading.container.innerHTML).toBe(asValue.container.innerHTML);
  });

  it("flags a bar drawn from a figure that is no longer current", () => {
    const { container } = render(
      <DivergingBar value={held(value("units/s", 4))} maxAbs={SCALE} />,
    );
    expect(container.querySelector("[data-not-current]")).not.toBeNull();
  });

  it("carries no mark of its own, having no reader to carry it to", () => {
    const { container } = render(
      <DivergingBar value={held(value("units/s", 4))} maxAbs={SCALE} />,
    );
    expect(container.querySelector("[data-not-current-mark]")).toBeNull();
    expect(container.querySelectorAll("[data-bound]")).toHaveLength(0);
  });

  it("keeps the sign a held figure arrived with", () => {
    const { container } = render(
      <DivergingBar value={held(value("units/s", -4))} maxAbs={SCALE} />,
    );
    const fill = container.querySelector("[data-not-current] > :last-child");
    expect(fill).not.toBeNull();
    expect(getComputedStyle(fill as Element).width).toBe("20%");
  });

  it("draws no fill at all for a reading that carries no number", () => {
    const { container } = render(
      <DivergingBar
        value={{ state: "pending", reckoning: { status: "none" } }}
        maxAbs={SCALE}
      />,
    );
    /*
     * The zero line survives, so the track still reads as a scale. What goes is
     * the fill, because a zero-width one sits on the line and says the term is
     * neither producing nor consuming.
     */
    const track = screen.getByTestId("diverging-bar");
    expect(track.children).toHaveLength(1);
  });

  it("stays decorative when it is faded", async () => {
    const { container } = render(
      <DivergingBar value={held(value("units/s", 4))} maxAbs={SCALE} />,
    );
    await expectNoA11yViolations(container);
  });
});
