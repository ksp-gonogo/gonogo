import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { holdRegime } from "./descentRegime";

describe("holdRegime", () => {
  it("shows the reported label when nothing is held", () => {
    expect(holdRegime(undefined, "decelerating", value("1", 1.08))).toBe(
      "decelerating",
    );
  });

  it("enters at-terminal on the first sample the mod reports it", () => {
    expect(holdRegime("decelerating", "at-terminal", value("1", 1.04))).toBe(
      "at-terminal",
    );
  });

  it("holds at-terminal through scatter just past its tolerance", () => {
    expect(holdRegime("at-terminal", "decelerating", value("1", 1.12))).toBe(
      "at-terminal",
    );
    expect(holdRegime("at-terminal", "accelerating", value("1", 0.83))).toBe(
      "at-terminal",
    );
  });

  it("leaves at-terminal on the first sample past the exit margin", () => {
    expect(holdRegime("at-terminal", "decelerating", value("1", 1.25))).toBe(
      "decelerating",
    );
    expect(holdRegime("at-terminal", "accelerating", value("1", 0.7))).toBe(
      "accelerating",
    );
  });

  it("shows the reported label when the ratio is unknown", () => {
    expect(holdRegime("at-terminal", "decelerating", null)).toBe(
      "decelerating",
    );
  });
});
