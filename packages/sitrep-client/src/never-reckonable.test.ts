import { reckonableValuesOf, TOPIC_IDS } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { isNeverReckonable, NEVER_RECKONABLE } from "./never-reckonable";
import { getReckoner } from "./reckoners";

/**
 * The classification cannot rot, because this is what reads it.
 *
 * A list recording a DEFAULT with no consumer rots without failing, which is
 * why recording class D per topic was argued against. This list has two
 * consumers: the type checker (which narrows a declared topic to
 * `UnmodelledReading`, dropping the `reckoning: "available"` members, so a wrong
 * entry surfaces as a branch that stops compiling) and this file, which asserts
 * every declared topic is real and that nothing is claimed both ways.
 */

describe("the never-reckonable declaration", () => {
  it("names only topics that exist", () => {
    // A renamed or deleted topic leaves a stale entry that narrows nothing and
    // reads as a decision someone made. Since the entry is what suppresses the
    // modelled members, a stale one is worse than absent.
    const known = new Set<string>(TOPIC_IDS);
    const unknown = NEVER_RECKONABLE.filter((t) => !known.has(t));
    expect(unknown).toEqual([]);
  });

  it("claims nothing that also has a registered model", () => {
    // The contradiction that matters: a topic both declared unmodellable AND
    // carrying a reckoner would have its modelled members suppressed by the type
    // while the store went on offering one, so the model would be unreachable
    // and nothing would say why.
    const contradictory = NEVER_RECKONABLE.filter(
      (t) => getReckoner(t) !== undefined,
    );
    expect(contradictory).toEqual([]);
  });

  it("has no duplicates, so a removal cannot be half-done", () => {
    expect([...new Set(NEVER_RECKONABLE)].length).toBe(NEVER_RECKONABLE.length);
  });

  it("claims nothing the contract declares reckonable", () => {
    // The same contradiction as the registered-model one above, caught a layer
    // earlier: a mark is a promise the WIRE carries a model's inputs, so a
    // marked topic listed here would suppress the very members the contract just
    // said were reachable. This is the one half of the reckonability gate that
    // pure C# structurally cannot see, because the list is TypeScript; it reads
    // two generated TS artifacts and no C# source, so it is not a cross-language
    // ratchet.
    const contradictory = NEVER_RECKONABLE.filter(
      (t) => reckonableValuesOf(t).length > 0,
    );
    expect(contradictory).toEqual([]);
  });

  it("agrees with its own runtime predicate", () => {
    for (const topic of NEVER_RECKONABLE) {
      expect(isNeverReckonable(topic)).toBe(true);
    }
    expect(isNeverReckonable("vessel.orbit")).toBe(false);
  });
});
