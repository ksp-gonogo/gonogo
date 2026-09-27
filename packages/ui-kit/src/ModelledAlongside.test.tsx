import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ReckonedUnit } from "./ModelledAlongside";

function phase(beyondReceived: boolean): Reading<Value<"°">> {
  return {
    state: "observed",
    value: value("°", 40),
    atUt: value("ut", 1_000),
    reckoning: {
      status: "available",
      modelled: value("°", 52),
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
