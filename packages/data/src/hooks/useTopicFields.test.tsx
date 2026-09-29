import { resolveValueTopic } from "@ksp-gonogo/sitrep-client";
import { SITUATION_NAMES } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { type TopicFieldKey, withEnumName } from "../schema/topicFieldCatalog";
import {
  useNumericFields,
  usePrintableFields,
  useTopicFieldCatalog,
} from "./useTopicFields";

function capture(hook: () => TopicFieldKey[]): TopicFieldKey[] {
  let captured: TopicFieldKey[] = [];
  function Probe() {
    captured = hook();
    return null;
  }
  render(<Probe />);
  return captured;
}

function keysOf(fields: TopicFieldKey[]): Set<string> {
  return new Set(fields.map((f) => f.key));
}

describe("useNumericFields", () => {
  it("offers a numeric field of a Topic no list names, with its unit", () => {
    const fields = capture(useNumericFields);
    const terminal = fields.find(
      (f) => f.key === "vessel.landing.terminalVelocity",
    );
    expect(terminal).toMatchObject({
      topic: "vessel.landing",
      unit: "m/s",
      kind: "quantity",
    });
  });

  it("does not offer an object, a collection, a name or a flag", () => {
    const keys = keysOf(capture(useNumericFields));
    expect(keys.has("career.status.balances.funds")).toBe(true);
    expect(keys.has("career.status.balances")).toBe(false);
    expect(keys.has("career.status.contracts.active")).toBe(false);
    expect(keys.has("vessel.landing.outcome")).toBe(false);
    expect(keys.has("vessel.control.sas")).toBe(false);
  });

  it("offers only fields with a magnitude, so every choice can be ordered", () => {
    for (const entry of capture(useNumericFields)) {
      expect(entry.kind).toBe("quantity");
      expect(entry.unit).toBeDefined();
    }
  });

  it("offers only keys that resolve to a Topic something can sample", () => {
    const fields = capture(useNumericFields);
    expect(fields.length).toBeGreaterThan(0);
    for (const entry of fields) {
      expect(resolveValueTopic(entry.key)).not.toBeUndefined();
    }
  });
});

describe("usePrintableFields", () => {
  it("offers numbers, names and flags a sentence can print", () => {
    const keys = keysOf(capture(usePrintableFields));
    expect(keys.has("vessel.landing.terminalVelocity")).toBe(true);
    expect(keys.has("vessel.landing.outcome")).toBe(true);
    expect(keys.has("vessel.control.sas")).toBe(true);
  });

  it("does not offer an object or a collection", () => {
    const keys = keysOf(capture(usePrintableFields));
    expect(keys.has("career.status.balances")).toBe(false);
    expect(keys.has("career.status.contracts.active")).toBe(false);
  });

  it("offers an enum carried by its ordinal, with the names it prints as", () => {
    const situation = capture(usePrintableFields).find(
      (f) => f.key === "vessel.identity.situation",
    );
    expect(situation?.enumEncoding).toEqual({
      by: "ordinal",
      names: expect.objectContaining({ 0: SITUATION_NAMES[0] }),
    });
  });

  it("offers an enum the wire already carries by name", () => {
    const coverage = capture(usePrintableFields).find(
      (f) => f.key === "reliability.summary.coverage",
    );
    expect(coverage?.enumEncoding).toEqual({ by: "name" });
  });

  it("offers no enum it cannot name", () => {
    for (const entry of capture(usePrintableFields)) {
      if (entry.kind === "enum") expect(entry.enumEncoding).toBeDefined();
    }
  });
});

describe("withEnumName", () => {
  const situation = () =>
    capture(useTopicFieldCatalog).find(
      (f) => f.key === "vessel.identity.situation",
    );

  it("prints an ordinal as its member's name", () => {
    expect(withEnumName(situation(), 0)).toBe(SITUATION_NAMES[0]);
  });

  it("passes an ordinal with no member through, since there is no word for it", () => {
    expect(withEnumName(situation(), 999)).toBe(999);
  });

  it("leaves a field that is not an ordinal enum alone", () => {
    expect(withEnumName(undefined, 3)).toBe(3);
  });
});
