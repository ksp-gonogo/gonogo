import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { DivergingBar } from "./DivergingBar";

/*
 * What `<DivergingBar>` draws when handed a whole `Reading`: the bar is
 * decorative, so its whole treatment is to fade.
 */

const AT = value("ut", 12_000);

function observed<Unit extends string>(
  quantity: Value<Unit>,
): Reading<Value<Unit>> {
  return {
    state: "observed",
    value: quantity,
    atUt: AT,
    reckoning: { status: "none" },
  };
}

function held<Unit extends string>(
  quantity: Value<Unit>,
): Reading<Value<Unit>> {
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

  it("flags a bar drawn from a figure that is held", () => {
    const { container } = render(
      <DivergingBar value={held(value("units/s", 4))} maxAbs={SCALE} />,
    );
    expect(container.querySelector("[data-held]")).not.toBeNull();
  });

  it("carries no mark of its own, having no reader to carry it to", () => {
    const { container } = render(
      <DivergingBar value={held(value("units/s", 4))} maxAbs={SCALE} />,
    );
    expect(container.querySelector("[data-held-mark]")).toBeNull();
    expect(container.querySelectorAll("[data-bound]")).toHaveLength(0);
  });

  it("keeps the sign a held figure arrived with", () => {
    const { container } = render(
      <DivergingBar value={held(value("units/s", -4))} maxAbs={SCALE} />,
    );
    const fill = container.querySelector("[data-held] > :last-child");
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
    // The zero line survives, so the track still reads as a scale; only the fill goes.
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
