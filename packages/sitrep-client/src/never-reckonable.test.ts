import { TOPIC_IDS } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { isNeverReckonable, NEVER_RECKONABLE } from "./never-reckonable";
import { getReckoner } from "./reckoners";

/**
 * The classification cannot rot, because this is what reads it.
 *
 * A list recording a DEFAULT with no consumer rots without failing, which is
 * why recording class D per topic was argued against. This list has two
 * consumers: the type checker (which drops the `reckonable` arm for a declared
 * topic, so a wrong entry surfaces as a branch that stops compiling) and this
 * file, which asserts every declared topic is real and that nothing is claimed
 * both ways.
 */

describe("the never-reckonable declaration", () => {
  it("names only topics that exist", () => {
    // A renamed or deleted topic leaves a stale entry that narrows nothing and
    // reads as a decision someone made. Since the entry is what suppresses an
    // arm, a stale one is worse than absent.
    const known = new Set<string>(TOPIC_IDS);
    const unknown = NEVER_RECKONABLE.filter((t) => !known.has(t));
    expect(unknown).toEqual([]);
  });

  it("claims nothing that also has a registered model", () => {
    // The contradiction that matters: a topic both declared unmodellable AND
    // carrying a reckoner would have its arm suppressed by the type while the
    // store went on offering one, so the model would be unreachable and nothing
    // would say why.
    const contradictory = NEVER_RECKONABLE.filter(
      (t) => getReckoner(t) !== undefined,
    );
    expect(contradictory).toEqual([]);
  });

  it("has no duplicates, so a removal cannot be half-done", () => {
    expect([...new Set(NEVER_RECKONABLE)].length).toBe(NEVER_RECKONABLE.length);
  });

  it("agrees with its own runtime predicate", () => {
    for (const topic of NEVER_RECKONABLE) {
      expect(isNeverReckonable(topic)).toBe(true);
    }
    expect(isNeverReckonable("vessel.orbit")).toBe(false);
  });
});
