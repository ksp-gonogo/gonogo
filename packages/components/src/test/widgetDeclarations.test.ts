import { classifyRequirement, getComponents } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import "../index";

/**
 * Every `dataRequirements` entry every built-in widget declares must be
 * something the app can actually resolve. See `classifyRequirement` in
 * `@ksp-gonogo/core` for the four legal forms and why each is trusted.
 *
 * This gate exists because the two consumers of `dataRequirements`
 * (`useWidgetStreamStatus`, `alarmMatchesWidget`) were both widened to accept
 * field paths, which is what lets a migrated widget say
 * `career.status.economy.funds` instead of `career.funds`. `isTopicCarried`
 * resolves a path without checking the leaf names a real field, so that
 * widening also accepts `career.status.economy.notAField` and renders it as a
 * permanent `undefined`. Nothing at runtime can tell those apart. This is
 * where they are told apart.
 *
 * It reads the REAL registry rather than scanning source for
 * `dataRequirements:` arrays. A regex over call sites is how the same
 * vocabulary audit already went wrong once, in both directions at once:
 * matching mentions inside comments while missing every multi-line and
 * dynamically-built declaration. The registry is what the dashboard itself
 * reads, so there is no second thing to keep in sync.
 *
 * WHAT THIS DOES NOT COVER, stated because a gate that looks total and isn't
 * is worse than no gate: it sees the widgets THIS package registers, and
 * nothing else. An Uplink's widgets (`mod/*​/client/src`) register into the
 * same registry at runtime but from packages this one does not depend on, so
 * their declarations are ungoverned here. `classifyRequirement` is exported
 * from `@ksp-gonogo/core` precisely so each Uplink client can run this same
 * assertion over its own registrations; none does yet.
 */
describe("widget dataRequirements resolve to something real", () => {
  const declared = getComponents().flatMap((def) =>
    (def.dataRequirements ?? []).map((requirement) => ({
      id: def.id,
      requirement,
    })),
  );

  it("found a non-trivial number of declarations (scan sanity check)", () => {
    // An empty registry would make the assertion below vacuous, which is the
    // exact way an allowlist-shaped gate passes while checking nothing.
    expect(declared.length).toBeGreaterThan(100);
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

  it("rejects a plausible-looking field that does not exist", () => {
    // The gate's own positive control: if this ever returns a kind, the
    // classifier has gone permissive and the suite above is checking nothing.
    expect(
      classifyRequirement("career.status.economy.notAField"),
    ).toBeUndefined();
    expect(classifyRequirement("vessel.state.notAField")).toBeUndefined();
    expect(classifyRequirement("career.status.economy.funds")).toBe(
      "field-path",
    );
    expect(classifyRequirement("career.status")).toBe("wire-topic");
    expect(classifyRequirement("vessel.state")).toBe("derived-channel");
    expect(classifyRequirement("career.funds")).toBe("legacy-key");
  });
});
