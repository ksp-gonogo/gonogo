import { classifyRequirement, getComponents } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import "./index";

/**
 * The declaration gate, applied to this Uplink's own widgets.
 *
 * `@ksp-gonogo/components` runs the identical assertion over the built-in
 * library, and it can only ever see what IT registers: an Uplink's widgets
 * register into the same global registry at runtime, but from a package the
 * built-in library does not depend on, so they were ungoverned. A gate that
 * looks total and is not is worse than no gate, which is why
 * `classifyRequirement` is exported rather than kept private to the library.
 *
 * See `classifyRequirement` in `@ksp-gonogo/core` for the four legal forms and
 * why each is trusted. The short version: `isTopicCarried` resolves a dotted
 * path at runtime without checking the leaf names a real field, so a typo'd
 * declaration renders `undefined` forever and never fails. This is where it
 * fails instead.
 */
describe("Breaking Ground widget dataRequirements resolve to something real", () => {
  const OWN_WIDGET_IDS = [
    "robotics-console",
    "rotor-tachometer",
    "deployed-science",
  ];

  const declared = OWN_WIDGET_IDS.flatMap((id) => {
    const def = getComponents().find((candidate) => candidate.id === id);
    return (def?.dataRequirements ?? []).map((requirement) => ({
      id,
      requirement,
    }));
  });

  it("registered all three widgets, each declaring something (scan sanity check)", () => {
    // Without this, a rename that silently unregisters a widget would empty
    // the list and make the assertion below pass over nothing.
    for (const id of OWN_WIDGET_IDS) {
      expect(
        getComponents().some((def) => def.id === id),
        `${id} is not registered`,
      ).toBe(true);
    }
    expect(declared.length).toBeGreaterThanOrEqual(OWN_WIDGET_IDS.length);
  });

  it("classifies every declaration, no unresolvable entries", () => {
    const unresolvable = declared
      .filter(
        ({ requirement }) => classifyRequirement(requirement) === undefined,
      )
      .map(({ id, requirement }) => `${id}: ${requirement}`)
      .sort();

    expect(unresolvable).toEqual([]);
  });
});
