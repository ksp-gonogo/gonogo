import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Commcast__Bar, Commcast__BarRadio } from "./commcastStyles";

describe("the Commcast bar in a narrow tile", () => {
  it("wraps onto further rows instead of running past the tile", () => {
    const { getByTestId } = render(
      <Commcast__Bar data-testid="bar">
        <Commcast__BarRadio data-testid="radio" />
      </Commcast__Bar>,
    );
    expect(getComputedStyle(getByTestId("bar")).flexWrap).toBe("wrap");
    expect(getComputedStyle(getByTestId("radio")).flexWrap).toBe("wrap");
  });
});
