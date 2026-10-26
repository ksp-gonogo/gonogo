import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Pips } from "./Pips";

describe("Pips", () => {
  it("draws one pip per step and says how many are filled", () => {
    const { container } = render(<Pips filled={2} of={3} label="Difficulty" />);
    expect(
      screen.getByRole("img", { name: "Difficulty: 2 of 3" }),
    ).toBeInTheDocument();
    expect(container.querySelector("[data-pips]")?.children).toHaveLength(3);
  });

  it("says the count alone with no label, zero filled included", () => {
    render(<Pips filled={0} of={3} />);
    expect(screen.getByRole("img", { name: "0 of 3" })).toBeInTheDocument();
  });
});
