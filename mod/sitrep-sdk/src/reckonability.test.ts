import { describe, expect, it } from "vitest";
import {
  reckonableInputSpelling,
  reckonableInputsOf,
  reckonableValuesOf,
} from "./reckonability";

/**
 * The accessor over the generated reckonability rows, at the one place the rows
 * stopped being one-per-value.
 *
 * `generated-reckonability.test.ts` owns whether CODEGEN emitted the right text.
 * This owns what the accessor answers, which is a different question and became
 * a real one the moment a value could carry two models: every function here used
 * to be able to assume one row per (topic, field).
 */
describe("a value served by two models", () => {
  it("answers with one row per model, each with its own inputs", () => {
    const rows = reckonableValuesOf("vessel.flight").filter(
      (row) => row.field === "altitudeAsl",
    );

    expect(rows.map((row) => row.basis)).toEqual([
      "kepler-propagation",
      "rate-integration",
    ]);
    // The point of two rows rather than one row with two bases: the input lists
    // differ, and a merged list could not say which inputs buy which model.
    expect(rows.map((row) => row.inputs.map(reckonableInputSpelling))).toEqual([
      ["@vessel.orbit", "@system.bodies"],
      ["verticalSpeed", "gForce", "@system.bodies"],
    ]);
  });

  it("unions the inputs across its models, deduped", () => {
    /*
     * `reckonableInputsOf` took the FIRST matching row, which was the same
     * answer while every value had one model and silently became the conic's
     * half of this one. A consumer asking "what do I need on the wire to carry
     * this forward" wants everything any model of it needs; a consumer asking
     * which inputs buy which model reads the rows above.
     *
     * `@system.bodies` is declared by BOTH models and appears once.
     */
    expect(
      reckonableInputsOf("vessel.flight", "altitudeAsl")?.map(
        reckonableInputSpelling,
      ),
    ).toEqual(["@vessel.orbit", "@system.bodies", "verticalSpeed", "gForce"]);
  });

  it("still answers undefined for a value no model carries", () => {
    // Distinct from an empty list on purpose: a mark's input list is never
    // empty, so empty could only have meant unmarked.
    expect(reckonableInputsOf("vessel.flight", "mach")).toBeUndefined();
    expect(reckonableInputsOf("no.such.topic", "anything")).toBeUndefined();
  });
});
