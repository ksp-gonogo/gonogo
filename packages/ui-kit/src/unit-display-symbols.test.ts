import { describe, expect, it } from "vitest";
import { GENERATED_UNIT_KINDS } from "./__generated__/unit-kinds";
import { writeQuantity } from "./units";

/** The currency names that a reader sees as a glyph or a letter, never spelled out. */
const CURRENCY_WORDS = /science|funds|reputation/i;

/** Every token whose written form carries a currency name as text. */
function spelledOutCurrencies(tokens: readonly string[]): string[] {
  return tokens.filter((token) =>
    CURRENCY_WORDS.test(writeQuantity({ magnitude: 1, unit: token })),
  );
}

describe("a unit never shows a currency's name as text", () => {
  it("holds for every unit the sdk defines", () => {
    expect(spelledOutCurrencies(Object.keys(GENERATED_UNIT_KINDS))).toEqual([]);
  });

  it("sees a token that spells a currency out", () => {
    expect(
      spelledOutCurrencies(["m", "xscience/day", "reputation_pts"]),
    ).toEqual(["xscience/day", "reputation_pts"]);
  });

  it("writes a currency rate with the currency's own symbol", () => {
    expect(writeQuantity({ magnitude: 12, unit: "science/day" })).toContain(
      "sci/day",
    );
  });

  it("writes a currency per megabyte with the currency's own symbol", () => {
    expect(writeQuantity({ magnitude: 3, unit: "science/MB" })).toContain(
      "sci/MB",
    );
  });
});
