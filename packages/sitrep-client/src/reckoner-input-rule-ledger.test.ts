import { describe, expect, it } from "vitest";
import {
  getReckonedTopics,
  getReckoner,
  getReckonerExemptions,
} from "./reckoners";

/**
 * The reviewed list of every input-rule opt-out core ships, and the reviewed
 * statement of how much of the shipped tree the rules currently constrain.
 *
 * ## Why the opt-outs need a file of their own
 *
 * The rules are a DEFAULT: a model gets a reach no further than its inputs and a
 * band no wider than its inputs warrant without its author writing anything. So
 * the exceptions are the only part anyone has to read, and an exception written
 * inside a model file is read once, by the person who wrote it. Here they are a
 * list, and adding one is a diff against that list rather than a line in a
 * three-hundred-line reckoner. An Uplink's half of the same list is on its
 * generated page, under `## Models`, off the same `getReckonerExemptions`.
 *
 * ## Why the second case is here at all
 *
 * Both rules are structurally enforced and, on this tree, INERT. Core's four
 * models declare `vessel.orbit`, `system.bodies` or nothing, and nobody models
 * those; every Uplink-owned model declares an unmodelled topic or no deps at
 * all. A rule with nothing to bite on reports clean forever and reads as working, which is
 * the failure the second case exists to stop: it pins the pairs where an input
 * carries a model of its own, the pairs are the only place either rule can act,
 * and the list is currently empty. The day it stops being empty someone has to
 * come back here and say which model is now constrained, which is the moment
 * worth catching.
 */

/** Every registered model's own topic paired with a dep that is itself modelled. */
function pairsTheRulesCanBiteOn(): string[] {
  const pairs: string[] = [];
  for (const { topic } of getReckonedTopics()) {
    const elected = getReckoner(topic);
    if (!elected) continue;
    for (const dep of elected.definition.deps) {
      const depTopic =
        typeof dep === "string"
          ? dep
          : "reading" in dep
            ? dep.reading
            : undefined;
      if (depTopic === undefined) continue;
      if (getReckoner(depTopic)) pairs.push(`${topic} <- ${depTopic}`);
    }
  }
  return pairs.sort();
}

describe("the input-rule ledger", () => {
  it("records every opt-out core's own models declared", () => {
    // Empty, and it should stay hard to change: core's vanilla models are the
    // ones every installed client runs, so an exemption here is one nobody
    // opted into. An addition needs the reason in the registration AND a line
    // here saying why the mathematics carries it.
    expect(getReckonerExemptions()).toEqual([]);
  });

  it("records which shipped models the rules actually constrain today", () => {
    // NONE of them, and that is the honest reading rather than a gap in the
    // suite. Neither rule can act on an input nobody models: an unmodelled
    // input is held-last, makes no claim about how far it reaches and publishes
    // no band, so there is no horizon to be capped by and no band to be no
    // narrower than. `reckoner-input-rules.test.ts` proves the mechanism against
    // synthetic models; this says what it currently reaches in the tree.
    expect(pairsTheRulesCanBiteOn()).toEqual([]);
  });
});
