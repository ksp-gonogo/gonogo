import { resolveValueTopic } from "@ksp-gonogo/sitrep-client";
import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import type { TopicFieldKey } from "../schema/topicFieldCatalog";
import { useNumericFields, usePrintableFields } from "./useTopicFields";

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
    expect(keys.has("career.status.economy.funds")).toBe(true);
    expect(keys.has("career.status.economy")).toBe(false);
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

  it("does not offer an object, a collection or an enum ordinal", () => {
    const fields = capture(usePrintableFields);
    const keys = keysOf(fields);
    expect(keys.has("career.status.economy")).toBe(false);
    expect(keys.has("career.status.contracts.active")).toBe(false);
    expect(fields.filter((f) => f.kind === "enum")).toEqual([]);
  });
});
