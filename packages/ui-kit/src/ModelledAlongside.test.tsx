import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ModelledAlongside, ReckonedUnit } from "./ModelledAlongside";

function phase(beyondReceived: boolean, modelled = 52): Reading<Value<"°">> {
  return {
    state: "observed",
    value: value("°", 40),
    atUt: value("ut", 1_000),
    reckoning: {
      status: "available",
      modelled: value("°", modelled),
      atUt: value("ut", 1_240),
      beyondReceived,
      basis: "kepler-propagation",
    },
  };
}

describe("ReckonedUnit", () => {
  it("draws the observation, and the model's figure beside it with the modelled mark", () => {
    const { container } = render(<ReckonedUnit value={phase(true)} />);
    const alongside = container.querySelector("[data-modelled-alongside]");
    expect(container.textContent).toMatch(/^40/);
    expect(alongside?.textContent).toMatch(/52/);
    expect(alongside?.querySelector("[data-held-mark]")).not.toBeNull();
  });

  it("draws the observation alone where the model stays at the received edge", () => {
    const { container } = render(<ReckonedUnit value={phase(false)} />);
    expect(container.querySelector("[data-modelled-alongside]")).toBeNull();
    expect(container.textContent).not.toMatch(/52/);
  });

  it("does not repeat a model that reads the same as the observation", () => {
    const { container } = render(<ReckonedUnit value={phase(true, 40.004)} />);
    expect(container.querySelector("[data-modelled-alongside]")).toBeNull();
  });

  it("draws a model that differs from the observation in the last place drawn", () => {
    const { container } = render(<ReckonedUnit value={phase(true, 40.04)} />);
    expect(
      container.querySelector("[data-modelled-alongside]")?.textContent,
    ).toMatch(/40\.04/);
  });

  it("draws nothing modelled beside a held reading", () => {
    const { container } = render(
      <ReckonedUnit
        value={{
          ...phase(true),
          state: "stale",
          asOfUt: value("ut", 1_000),
          grade: "held-stale",
        }}
      />,
    );
    expect(container.querySelector("[data-modelled-alongside]")).toBeNull();
  });

  it("has no axe violations with the modelled figure drawn", async () => {
    const { container } = render(<ReckonedUnit value={phase(true)} />);
    await expectNoA11yViolations(container);
  });
});

describe("ModelledAlongside", () => {
  const whole = (n: number) => n.toFixed(0);

  it("draws a figure that writes apart from the observation", () => {
    const { container } = render(
      <ModelledAlongside observed={20} modelled={17} write={whole} />,
    );
    const alongside = container.querySelector("[data-modelled-alongside]");
    expect(alongside?.textContent).toMatch(/^17/);
    expect(alongside?.querySelector("[data-held-mark]")).not.toBeNull();
  });

  it("draws nothing where the figure writes the same as the observation", () => {
    const { container } = render(
      <ModelledAlongside observed={50} modelled={49.97} write={whole} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("draws a figure beside an observation that drew no figure", () => {
    const { container } = render(
      <ModelledAlongside observed={null} modelled={17} write={whole} />,
    );
    expect(container.querySelector("[data-modelled-alongside]")).not.toBeNull();
  });

  it("draws nothing without a modelled figure", () => {
    const { container } = render(
      <ModelledAlongside observed={20} modelled={undefined} write={whole} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("compares a quantity at its own unit's precision", () => {
    const drawn = (observed: Value<string>, modelled: Value<string>) =>
      render(
        <ModelledAlongside observed={observed} modelled={modelled} />,
      ).container.querySelector("[data-modelled-alongside]");
    expect(drawn(value("m", 250_000), value("m", 250_040))).toBeNull();
    expect(drawn(value("m", 250_000), value("m", 250_120))).not.toBeNull();
    expect(drawn(value("°", 40), value("°", 40.04))).not.toBeNull();
  });
});
