import { getComponents } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import "../index";

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Saved input bindings refer to an action by id, so every id a built-in
 * widget declares is kebab-case, the one spelling that is stable across
 * widgets. Reads the real registry, not source text.
 */
describe("widget action ids are kebab-case", () => {
  const declared = getComponents().flatMap((def) =>
    (def.actions ?? []).map((action) => ({ widget: def.id, id: action.id })),
  );

  it("found a non-trivial number of actions (scan sanity check)", () => {
    expect(declared.length).toBeGreaterThan(20);
  });

  it("spells every action id in kebab-case", () => {
    const offenders = declared
      .filter(({ id }) => !KEBAB_CASE.test(id))
      .map(({ widget, id }) => `${widget}: ${id}`);
    expect(offenders).toEqual([]);
  });

  it("rejects a camelCase id", () => {
    expect(KEBAB_CASE.test("toggleFollow")).toBe(false);
    expect(KEBAB_CASE.test("toggle-follow")).toBe(true);
  });
});
