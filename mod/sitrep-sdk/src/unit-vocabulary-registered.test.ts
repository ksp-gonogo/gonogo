import { describe, expect, it } from "vitest";
import descriptor from "./__generated__/units.json" with { type: "json" };
import { lookupUnit } from "./unit-system/registry";

/**
 * The tokens the contract uses for a field that is not a quantity: a flag, an
 * enum member, an identifier, free text, and `n/a` for a field with no unit at
 * all. `wrapTopicPayload` leaves these bare, so none of them has a definition.
 */
const NON_QUANTITY_TOKENS: ReadonlySet<string> = new Set([
  "enum",
  "flag",
  "id",
  "n/a",
  "text",
]);

/** Every token of `vocabulary` that is neither a registered unit nor a non-quantity token. */
function unregistered(vocabulary: readonly string[]): string[] {
  return vocabulary.filter(
    (token) =>
      !NON_QUANTITY_TOKENS.has(token) && lookupUnit(token) === undefined,
  );
}

/**
 * Every unit token a `[SitrepUnit]` field carries must resolve in the unit
 * system, so a figure the contract calls a quantity can be wrapped, converted
 * and drawn by `<Unit>`. A token that resolves nowhere reaches the screen as a
 * bare number or as a spelled-out dimension.
 */
describe("the contract's unit vocabulary is registered", () => {
  it("resolves every quantity token the contract uses", () => {
    expect(unregistered(descriptor.vocabulary)).toEqual([]);
  });

  it("sees an unregistered token and a compound of unregistered parts", () => {
    expect(unregistered(["m", "snacks/kerbal", "science/MB"])).toEqual([
      "snacks/kerbal",
      "science/MB",
    ]);
  });
});
