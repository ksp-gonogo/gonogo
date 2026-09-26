import { describe, expect, it } from "vitest";
import { GENERATED_UNIT_KINDS } from "./__generated__/unit-kinds";
import { durationTierSymbols, irlDurationTierSymbols } from "./formatDuration";
import { LADDERS } from "./units";

/**
 * No duration tier symbol may also name an unrelated dimension (a minute tier
 * of "m" reads as metres, worse once a badge uppercases it). The tiers may
 * repeat across `time` and `irlTime`, because both render as composite strings
 * built by the duration formatters and are never looked up symbol by symbol.
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
