import { existsSync, readFileSync } from "node:fs";
import { lookupUnit } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";

/*
 * The tokens a field carries when it is not a quantity: a flag, an enum member, an identifier, free text, and `n/a` for a field with no unit at all.
 * The value layer leaves these bare, so none of them has a definition.
 */
const NON_QUANTITY_TOKENS: ReadonlySet<string> = new Set([
  "enum",
  "flag",
  "id",
  "n/a",
  "text",
]);

/** The currency names the screen shows as a glyph or a letter and never as a word. */
const CURRENCY_WORDS = /science|funds|reputation/i;

/** Every unit token the generated `units.json` gives a field, in a set. */
function usedUnitTokens(unitsPath: string): Set<string> {
  const used = new Set<string>();
  if (!existsSync(unitsPath)) return used;
  const parsed: unknown = JSON.parse(readFileSync(unitsPath, "utf8"));
  if (typeof parsed === "object" && parsed !== null) {
    for (const section of ["types", "topics"]) {
      const byName = Object.entries(parsed).find(
        ([key]) => key === section,
      )?.[1];
      if (typeof byName !== "object" || byName === null) continue;
      for (const fields of Object.values(byName)) {
        if (typeof fields !== "object" || fields === null) continue;
        for (const token of Object.values(fields)) {
          if (typeof token === "string") used.add(token);
        }
      }
    }
  }
  return used;
}

/**
 * Every unit token the Uplink's generated `units.json` gives a field that
 * resolves to no unit: neither one the sdk defines nor one the client has
 * registered. Read after the client has loaded, because the client's own
 * `registerUnit` calls are what make its tokens resolve. A token in this list
 * reaches the screen as a bare number or as a spelled-out dimension.
 */
export function unresolvedUnitTokens(unitsPath: string): string[] {
  return [...usedUnitTokens(unitsPath)]
    .filter(
      (token) =>
        !NON_QUANTITY_TOKENS.has(token) && lookupUnit(token) === undefined,
    )
    .sort();
}

/**
 * Every unit token in `units.json` that the screen would write with a currency's
 * name (`science`, `funds`, `reputation`) as text. A currency is drawn as its
 * glyph or letter, so a token that comes out spelled in words is one the unit
 * display does not know how to draw.
 */
export function currencyWordTokens(unitsPath: string): string[] {
  return [...usedUnitTokens(unitsPath)]
    .filter(
      (token) =>
        !NON_QUANTITY_TOKENS.has(token) &&
        CURRENCY_WORDS.test(writeQuantity({ magnitude: 1, unit: token })),
    )
    .sort();
}
