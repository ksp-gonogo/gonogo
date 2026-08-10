import { describe, expect, it } from "vitest";
import { GENERATED_UNIT_KINDS } from "./__generated__/unit-kinds";
import { durationTierSymbols, irlDurationTierSymbols } from "./formatDuration";
import { LADDERS } from "./units";

/**
 * Guard for the bug that shipped a Kerbalism death-clock badge reading "~4M
 * TO FATAL": `formatDuration`'s own minute tier used the bare symbol "m",
 * silently colliding with the `length` kind's metre, and a severity
 * `Badge`'s `text-transform: uppercase` finished the job of making "4m"
 * indistinguishable from four METRES.
 *
 * `styleguide-unit-adoption.test.ts` did not catch it and never would: it
 * only checks that a value ROUTES THROUGH the unit layer
 * (`Unit`/`speakQuantity`/`writeQuantity`), never a hand-typed symbol next
 * to a number. It says nothing about whether the symbol that layer hands
 * back is itself unambiguous. This is the guard for THAT gap: no ladder
 * tier symbol may name two different dimensions.
 *
 * One deliberate exception. A duration-ladder tier symbol
 * ("y"/"d"/"h"/"min"/"s") legitimately repeats across the two duration
 * kinds, `time` (the in-game calendar) and `irlTime` (its wall-clock twin):
 * both render as a composite, interleaved string ("2h 15min") built by
 * `formatDuration`/`formatIrlDuration` directly, never resolved through a
 * single symbol->kind lookup the way every other unit is, so a reader is
 * never shown one in a context where the other kind's own reading also
 * appears. What a duration tier must never do is collide with a symbol from
 * an UNRELATED dimension, because that symbol IS looked up standalone by
 * `kindOfUnit`/`displaySymbol` and IS shown beside other units of that same
 * dimension elsewhere on the same screen, which is exactly the shape of the
 * bug above.
 */
describe("no duration-ladder tier symbol collides with an unrelated kind's symbol", () => {
  const DURATION_KINDS = new Set(["time", "irlTime"]);

  /** Every symbol declared for a non-duration kind, mapped to that kind. */
  function otherKindSymbols(): Map<string, string> {
    const bySymbol = new Map<string, string>();
    for (const [symbol, def] of Object.entries(GENERATED_UNIT_KINDS)) {
      if (DURATION_KINDS.has(def.kind)) continue;
      bySymbol.set(symbol, def.kind);
    }
    for (const [kind, rungs] of Object.entries(LADDERS)) {
      if (DURATION_KINDS.has(kind)) continue;
      for (const rung of rungs) {
        if (!bySymbol.has(rung.symbol)) bySymbol.set(rung.symbol, kind);
      }
    }
    return bySymbol;
  }

  function collisions(symbols: readonly string[]): string[] {
    const others = otherKindSymbols();
    return symbols
      .filter((symbol) => others.has(symbol))
      .map((symbol) => `"${symbol}" also names kind "${others.get(symbol)}"`);
  }

  it("the game-time ladder (formatDuration) stays clear of every other dimension", () => {
    expect(collisions(durationTierSymbols())).toEqual([]);
  });

  it("the wall-clock ladder (formatIrlDuration) stays clear of every other dimension", () => {
    expect(collisions(irlDurationTierSymbols())).toEqual([]);
  });
});
