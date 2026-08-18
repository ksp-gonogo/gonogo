import { describe, expect, it } from "vitest";
import { UNIT_DEFINITIONS } from "./definitions";
import * as Dim from "./dimension";
import { declaredUnitFor } from "./registry";

/**
 * The two layers must agree on which unit a COMPUTED dimension is called.
 *
 * `force.times(distance)` lands on `{kg:1,m:2,s:-2}`, and two ratio-1 units
 * claim it: `J` and `N·m`. Something has to break the tie, and the two layers
 * break it by different means:
 *
 * - **Runtime**: `declaredUnitFor` returns the FIRST ratio-1 unit registered
 *   for the dimension. Order comes from `UNIT_DEFINITIONS`.
 * - **Types**: `CanonicalUnit` in `algebra.ts` excludes anything flagged
 *   `alias: true`, because the order of a union produced by a mapped-type
 *   lookup is not specified by TypeScript and must not be relied on.
 *
 * Two mechanisms, one answer required. If they ever diverge, a value renders
 * as `J` and type-checks as `N·m`, which is the kind of split nobody notices
 * until something downstream compares the two. That is what this file exists
 * to prevent, and it is why `alias` is a property of the DATA rather than a
 * type-only union: a type-only list could not be checked from here at all.
 */

type Definition = (typeof UNIT_DEFINITIONS)[keyof typeof UNIT_DEFINITIONS];

const entries = Object.entries(UNIT_DEFINITIONS) as Array<
  [string, Definition & { readonly alias?: true }]
>;

/** Ratio-1 units are the only ones a computed value can resolve to. */
const canonical = entries.filter(([, def]) => def.ratio === 1);

describe("the alias flag", () => {
  it("is set on exactly the units the runtime does NOT pick", () => {
    const disagreements = canonical
      .map(([symbol, def]) => {
        const runtimeWinner = declaredUnitFor(Dim.key(def.dim));
        const runtimePicksIt = runtimeWinner === symbol;
        const flaggedAlias = def.alias === true;
        // Flagged as an alias but the runtime picks it, or not flagged and the
        // runtime picks something else: either way the layers disagree.
        return runtimePicksIt === flaggedAlias
          ? `${symbol}: runtime picks ${String(runtimeWinner)}, alias=${flaggedAlias}`
          : null;
      })
      .filter((entry) => entry !== null);

    expect(disagreements).toEqual([]);
  });

  it("covers every dimension that has more than one ratio-1 unit", () => {
    const byDimension = new Map<string, string[]>();
    for (const [symbol, def] of canonical) {
      const key = Dim.key(def.dim);
      byDimension.set(key, [...(byDimension.get(key) ?? []), symbol]);
    }

    // Exactly one unflagged winner per contested dimension, or the type layer
    // resolves to a union and every downstream `Equal` fails silently.
    const contested = [...byDimension.values()].filter(
      (symbols) => symbols.length > 1,
    );
    for (const symbols of contested) {
      const unflagged = symbols.filter(
        (symbol) =>
          (
            UNIT_DEFINITIONS[symbol as keyof typeof UNIT_DEFINITIONS] as {
              alias?: true;
            }
          ).alias !== true,
      );
      expect(unflagged, `contested: ${symbols.join(" vs ")}`).toHaveLength(1);
    }

    // Pinned, so that a NEW collision added to the catalogue shows up here as a
    // failure rather than as a silently degraded type somewhere else. Four
    // since `ut` joined `s` on `{s:1}`: an instant on the universal-time clock
    // and a duration share a dimension deliberately, because a UT plus a
    // duration is a UT, and `s` stays the winner because a COMPUTED `{s:1}` is
    // always a duration.
    expect(contested).toHaveLength(4);
  });

  it("leaves every uncontested ratio-1 unit unflagged", () => {
    // A stray flag would make a perfectly good unit unreachable as a computed
    // result, which degrades to `Value<string>` and errors nowhere.
    const strays = canonical
      .filter(([symbol, def]) => {
        if (def.alias !== true) return false;
        return declaredUnitFor(Dim.key(def.dim)) === symbol;
      })
      .map(([symbol]) => symbol);

    expect(strays).toEqual([]);
  });
});
