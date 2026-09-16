import { describe, expect, it } from "vitest";
import type { TopicCurrency, TopicReckoning } from "./reading";
import { topicReading } from "./reading";
import { value } from "./unit-system/value";

/**
 * The collection-indexed field accessor #38 asked for and #250 recorded:
 *
 * > the design must reach a band under a COLLECTION-INDEXED path with a typed
 * > accessor, not `bandFor(reckoned, string)`
 *
 * The live case it was filed for is an Uplink slice keying its bands by
 * `` `${subject}.rules.${index}.value` ``, so the shape under test is a map of
 * subjects, each holding a collection, each entry carrying the modelled field.
 *
 * The load-bearing pair is "reaches the band under a collection-indexed path",
 * which proves the mechanism, and "CANNOT reach a leaf whose name is a reserved
 * currency member", which is why that live case still needs its field renamed.
 */

const AT = value("ut", 1_000);

/** Subjects by name, each holding a collection: the shape a per-subject model keys by. */
interface Rule {
  value: number;
  limit: number;
}
interface Kerbal {
  rules: Rule[];
}
interface Crew {
  crew: Record<string, Kerbal>;
}

const band = (lo: number, hi: number) => ({
  lo: value("ratio", lo),
  value: value("ratio", (lo + hi) / 2),
  hi: value("ratio", hi),
  kind: "sigma1" as const,
});

function crewReading(
  bands: Record<string, ReturnType<typeof band>> = {},
  modelledPaths: readonly string[] = [
    "crew.Bill.rules.0.value",
    "crew.Bill.rules.0.limit",
  ],
) {
  const payload: Crew = {
    crew: { Bill: { rules: [{ value: 3, limit: 10 }] } },
  };
  const currency: TopicCurrency<Crew, TopicReckoning<Crew>> = {
    state: "observed",
    value: payload,
    atUt: AT,
    reckoning: {
      status: "available",
      value: payload,
      atUt: AT,
      basis: "rate-integration",
      owner: "core",
      modelled: modelledPaths.map((path) => ({
        path,
        basis: "rate-integration" as const,
      })),
      bands,
    },
  };
  return topicReading(currency);
}

/** The first rule's reading, with the index guard written once. */
function firstRule(reading: ReturnType<typeof crewReading>) {
  const rule = reading.crew.Bill.rules[0];
  if (!rule) throw new Error("fixture has no rule 0");
  return rule;
}

describe("a field reading reaches through the payload", () => {
  it("walks a nested object path to a leaf's own reading", () => {
    expect(firstRule(crewReading()).limit.value).toBe(10);
  });

  it("walks a MAP KEY, in both spellings, to the same reading", () => {
    const r = crewReading();
    expect(r.crew.Bill.rules[0]).toBe(r.crew["Bill"].rules[0]);
  });

  it("carries the topic's currency down to the leaf", () => {
    const rule = firstRule(crewReading());
    expect(rule.limit.state).toBe("observed");
    expect(rule.limit.atUt?.magnitude).toBe(1_000);
  });

  /**
   * The one this exists for. The band is keyed by the dotted path the MODEL
   * wrote, and the accessor composes the identical string on the way down, so
   * no consumer spells a path and `bandFor(reckoned, "...")` is not needed.
   */
  it("reaches the band under a collection-indexed path", () => {
    const leaf = firstRule(
      crewReading({ "crew.Bill.rules.0.limit": band(0.2, 0.4) }),
    ).limit;
    expect(leaf.reckoning.status).toBe("available");
    if (leaf.reckoning.status !== "available") throw new Error("unreachable");
    expect(leaf.reckoning.band?.lo.magnitude).toBeCloseTo(0.2);
    expect(leaf.reckoning.band?.hi.magnitude).toBeCloseTo(0.4);
  });

  it("offers no band where the model wrote none at that path", () => {
    const leaf = firstRule(
      crewReading({ "crew.Bill.rules.0.value": band(9, 11) }),
    ).limit;
    if (leaf.reckoning.status !== "available") throw new Error("unreachable");
    expect(leaf.reckoning.band).toBeUndefined();
  });

  it("offers no model where the model covers no entry at that path", () => {
    const leaf = firstRule(crewReading({}, ["crew.Bill.rules.0.value"])).limit;
    expect(leaf.reckoning.status).toBe("none");
  });

  /**
   * THE LIMIT, and it lands exactly on the case #250 named.
   *
   * The model this was filed for keys its bands by
   * `` `${subject}.rules.${index}.value` `` and the leaf segment is literally
   * `value`, one of
   * the six reserved currency names. So the accessor reaches `rules[0]` and
   * stops: `.value` there answers with the READING's value, which is the rule
   * payload object, not a field reading for the leaf.
   *
   * Asserted rather than left implicit, because it is the difference between
   * "the accessor serves #250" and "the accessor serves #250 once that field
   * is renamed". It is the second.
   */
  it("CANNOT reach a leaf whose name is a reserved currency member", () => {
    const rule = firstRule(
      crewReading({ "crew.Bill.rules.0.value": band(0.2, 0.4) }),
    );
    const payload = rule.value as Rule | undefined;
    expect(payload?.value).toBe(3);
    // Not a Reading: no currency on it at all.
    expect(payload && "reckoning" in payload).toBe(false);
  });

  /**
   * The currency wins over a payload member of the same name. Asserted so the
   * precedence is a decision on the record rather than proxy trivia: `.state`
   * on a field reading is ALWAYS the reading's own.
   */
  it("answers with the currency, not a payload field of the same name", () => {
    const rule = firstRule(crewReading());
    expect(rule.state).toBe("observed");
    expect((rule.value as Rule | undefined)?.limit).toBe(10);
  });

  it("returns the same reading object for the same path", () => {
    const r = crewReading();
    expect(firstRule(r).limit).toBe(firstRule(r).limit);
  });

  it("answers about a field even where the topic has no payload", () => {
    const pending: TopicCurrency<Crew, { readonly status: "none" }> = {
      state: "pending",
      reckoning: { status: "none" },
    };
    const r = topicReading<Crew>(pending);
    expect(r.crew.Bill.rules[0]?.state).toBe("pending");
  });
});
