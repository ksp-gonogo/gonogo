import { describe, expect, it } from "vitest";
import type { TopicCurrency, TopicReckoning } from "./reading";
import { topicReading } from "./reading";
import { value } from "./unit-system/value";

/**
 * A field reading reaches a band keyed by a collection-indexed path, composed
 * one property at a time, so a consumer never spells the path the model wrote.
 */

const AT = value("ut", 1_000);

/** Subjects by name, each holding a collection: the shape a per-subject model keys by. */
interface Rule {
  value: number;
  problem: number;
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
    "crew.Bill.rules.0.problem",
    "crew.Bill.rules.0.limit",
  ],
) {
  const payload: Crew = {
    crew: { Bill: { rules: [{ value: 3, problem: 4, limit: 10 }] } },
  };
  const currency: TopicCurrency<Crew, TopicReckoning<Crew>> = {
    state: "observed",
    value: payload,
    atUt: AT,
    reckoning: {
      status: "available",
      value: payload,
      atUt: AT,
      beyondReceived: false,
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
    // biome-ignore lint/complexity/useLiteralKeys: the two spellings ARE the assertion. Collapsing the computed key to a dot key leaves `toBe` comparing one expression with itself, which passes whatever the proxy does.
    expect(r.crew.Bill.rules[0]).toBe(r.crew["Bill"].rules[0]);
  });

  it("carries the topic's currency down to the leaf", () => {
    const rule = firstRule(crewReading());
    expect(rule.limit.state).toBe("observed");
    expect(rule.limit.atUt?.magnitude).toBe(1_000);
  });

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
      crewReading({ "crew.Bill.rules.0.problem": band(9, 11) }),
    ).limit;
    if (leaf.reckoning.status !== "available") throw new Error("unreachable");
    expect(leaf.reckoning.band).toBeUndefined();
  });

  it("offers no model where the model covers no entry at that path", () => {
    const leaf = firstRule(
      crewReading({}, ["crew.Bill.rules.0.problem"]),
    ).limit;
    expect(leaf.reckoning.status).toBe("none");
  });

  it("offers no model for a field the model copied, though it claims the root", () => {
    const r = crewReading({}, ["", "crew.Bill.rules.0.problem"]);
    expect(firstRule(r).limit.reckoning.status).toBe("none");
    expect(firstRule(r).problem.reckoning.status).toBe("available");
  });

  it("inherits a basis from a moved field to the fields inside it", () => {
    const r = crewReading({}, ["", "crew.Bill.rules.0"]);
    expect(firstRule(r).limit.reckoning.status).toBe("available");
  });

  /** A reserved name answers with the reading's own member, so that leaf has no field reading. */
  it("CANNOT reach a leaf whose name is a reserved currency member", () => {
    const rule = firstRule(
      crewReading({ "crew.Bill.rules.0.problem": band(0.2, 0.4) }),
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
