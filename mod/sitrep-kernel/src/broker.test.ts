import { describe, expect, it } from "vitest";
import { topoSortActivationOrder } from "./broker";
import { DependencyCycleError } from "./errors";

describe("topoSortActivationOrder", () => {
  it("orders a dependent after its dependency", () => {
    const order = topoSortActivationOrder([
      { id: "base", deps: [] },
      { id: "dependent", deps: ["base"] },
    ]);

    expect(order.indexOf("base")).toBeLessThan(order.indexOf("dependent"));
    expect(order).toHaveLength(2);
  });

  it("orders a dependent after its dependency even when the dependent is registered first", () => {
    const order = topoSortActivationOrder([
      { id: "dependent", deps: ["base"] },
      { id: "base", deps: [] },
    ]);

    expect(order.indexOf("base")).toBeLessThan(order.indexOf("dependent"));
  });

  it("is deterministic: independent nodes keep registration order, dependents slot in right after their dependency clears", () => {
    const order = topoSortActivationOrder([
      { id: "x", deps: [] },
      { id: "a", deps: [] },
      { id: "b", deps: ["a"] },
    ]);

    expect(order).toEqual(["x", "a", "b"]);
  });

  it("handles a chain of transitive dependencies", () => {
    const order = topoSortActivationOrder([
      { id: "c", deps: ["b"] },
      { id: "a", deps: [] },
      { id: "b", deps: ["a"] },
    ]);

    expect(order).toEqual(["a", "b", "c"]);
  });

  it("ignores a dep referencing a capability that isn't in the node set (absent capability)", () => {
    const order = topoSortActivationOrder([
      { id: "dependent", deps: ["nowhere"] },
    ]);

    expect(order).toEqual(["dependent"]);
  });

  it("throws DependencyCycleError for a direct two-node cycle", () => {
    expect(() =>
      topoSortActivationOrder([
        { id: "a", deps: ["b"] },
        { id: "b", deps: ["a"] },
      ]),
    ).toThrow(DependencyCycleError);
  });

  it("names the capabilities involved in the cycle on the thrown error", () => {
    let thrown: unknown;
    try {
      topoSortActivationOrder([
        { id: "a", deps: ["b"] },
        { id: "b", deps: ["a"] },
      ]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(DependencyCycleError);
    const err = thrown as DependencyCycleError;
    expect(err.cycle).toContain("a");
    expect(err.cycle).toContain("b");
    expect(err.message).toContain("a");
    expect(err.message).toContain("b");
  });

  it("throws DependencyCycleError for a longer cycle (a -> b -> c -> a)", () => {
    expect(() =>
      topoSortActivationOrder([
        { id: "a", deps: ["b"] },
        { id: "b", deps: ["c"] },
        { id: "c", deps: ["a"] },
      ]),
    ).toThrow(DependencyCycleError);
  });

  it("throws DependencyCycleError for a self-dependency", () => {
    expect(() => topoSortActivationOrder([{ id: "a", deps: ["a"] }])).toThrow(
      DependencyCycleError,
    );
  });

  it("does not flag a cycle when a node not on the cycle depends on a cyclic node", () => {
    // "outer" depends on "a", and a<->b cycle among themselves; still a
    // cycle overall so this should still throw — but exercises that the
    // cycle path found doesn't need to include "outer".
    let thrown: unknown;
    try {
      topoSortActivationOrder([
        { id: "outer", deps: ["a"] },
        { id: "a", deps: ["b"] },
        { id: "b", deps: ["a"] },
      ]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DependencyCycleError);
    const err = thrown as DependencyCycleError;
    expect(err.cycle).not.toContain("outer");
  });
});
