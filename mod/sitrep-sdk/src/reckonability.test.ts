import { describe, expect, it } from "vitest";
import { GENERATED_RECKONABLE_VALUES } from "./__generated__/reckonability";
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

/**
 * The shape of the DECLARED graph, asked before anything walks it.
 *
 * A reckonable value names inputs, and an input can itself be a reckonable
 * value, so the rows describe a directed graph over `(topic, field)` nodes. A
 * consumer that propagates anything along it (an uncertainty, a horizon, a
 * provenance trail) is walking that graph, and a cycle walked without a guard
 * is a hang or a stack overflow on a live client rather than a wrong number.
 *
 * So the question is asked here, of the rows, rather than assumed by whoever
 * walks them.
 */

/** Every `(topic, field)` node the rows declare, as one key per value. */
function declaredNodes(): Set<string> {
  return new Set(
    GENERATED_RECKONABLE_VALUES.map((row) => `${row.topic}.${row.field}`),
  );
}

/**
 * The edges: one per declared input that is ITSELF a declared value.
 *
 * An input is resolved to a node the way a consumer would resolve it: a path on
 * the value's own payload (`topic: ""`) names a sibling field of the same
 * topic, and a cross-topic input names another topic's whole payload or one
 * field of it. An input naming something no model carries is not an edge at
 * all, which is the majority: it is a measurement, and a measurement is where a
 * walk stops.
 */
function declaredEdges(): [from: string, to: string][] {
  const nodes = declaredNodes();
  const edges: [string, string][] = [];
  for (const row of GENERATED_RECKONABLE_VALUES) {
    const from = `${row.topic}.${row.field}`;
    for (const input of row.inputs) {
      const to =
        input.topic === ""
          ? `${row.topic}.${input.path}`
          : `${input.topic}.${input.path}`;
      if (nodes.has(to)) edges.push([from, to]);
    }
  }
  return edges;
}

/** Every cycle the declared graph holds, each as the nodes it runs through. */
function declaredCycles(): string[] {
  const out = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const [from, to] of declaredEdges()) {
    adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
  }
  const walk = (node: string, path: string[]): void => {
    const seenAt = path.indexOf(node);
    if (seenAt !== -1) {
      // Rotated to its smallest member so one cycle found from two entry points
      // is reported once rather than twice.
      const ring = path.slice(seenAt);
      const pivot = ring.indexOf([...ring].sort()[0]);
      out.add([...ring.slice(pivot), ...ring.slice(0, pivot)].join(" then "));
      return;
    }
    for (const next of adjacency.get(node) ?? []) walk(next, [...path, node]);
  };
  for (const node of declaredNodes()) walk(node, []);
  return [...out].sort();
}

describe("the declared reckonability graph", () => {
  it("is NOT acyclic, and the one cycle in it is a state vector naming itself", () => {
    /*
     * `vessel.orbit.truth`'s position declares its velocity and its velocity
     * declares its position, which is the honest declaration: one conic
     * propagates the whole state vector, so neither half is carriable without
     * the other. It is a cycle all the same, and it is the reason nothing may
     * walk these rows without a visited set.
     *
     * Written down rather than asserted away because an acyclicity assertion
     * here would simply fail, and a walk written against the belief that it
     * holds would not fail at all until the frame it hung on.
     */
    expect(declaredCycles()).toEqual([
      "vessel.orbit.truth.position then vessel.orbit.truth.velocity",
    ]);
  });

  it("puts no cycle on the altitude, whose inputs are all measurements", () => {
    // Both models of `vessel.flight.altitudeAsl` reach only values nothing
    // carries forward: the elements, the body roster, the observed descent rate
    // and the sensed deceleration. A walk from here terminates in one step.
    expect(
      declaredEdges().filter(([from]) => from === "vessel.flight.altitudeAsl"),
    ).toEqual([]);
  });
});
