import { classifyRequirement, getComponents } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
// Side-effect imports: each Uplink client registers its widgets, augments and
// Topics at module load, exactly as `main.tsx` gets them. Every one of the nine
// is already a declared dependency of this package, so this costs no new edge.
import "@ksp-gonogo/gonogo-avionics-uplink";
import "@ksp-gonogo/gonogo-breaking-ground-uplink";
import "@ksp-gonogo/gonogo-kerbalism-uplink";
import "@ksp-gonogo/gonogo-kerbcast-uplink";
import "@ksp-gonogo/gonogo-kos-uplink";
import "@ksp-gonogo/gonogo-mechjeb-uplink";
import "@ksp-gonogo/gonogo-principia-uplink";
import "@ksp-gonogo/gonogo-realantennas-uplink";
import "@ksp-gonogo/gonogo-scansat-uplink";

/**
 * The Uplink half of `packages/components/src/test/widgetDeclarations.test.ts`.
 *
 * That gate reads the real registry and classifies every `dataRequirements`
 * entry, and it says plainly what it cannot see: the widgets THIS package
 * registers, and nothing else. An Uplink's widgets register into the same
 * registry from packages `components` does not depend on, so their declarations
 * were governed by nothing. Nine Uplinks, and `mod/*​/client` is where new
 * widgets now go.
 *
 * ## Why it lives here rather than in each Uplink
 *
 * The obvious reading is that each Uplink client should run the assertion over
 * its own registrations, and that reading is wrong twice.
 *
 * A gate inside an Uplink cannot be run by the third-party authors those
 * Uplinks exist to model: `docs/uplink-isolation.md` forbids reaching for an
 * app-internal package from `mod/*​/client`, and `classifyRequirement` lives in
 * `@ksp-gonogo/core`, which is private and unpublished. This exact strategy was
 * tried and removed rather than allowlisted, and it is now a NAMED BAN in
 * `uplink-isolation.allowlist.ts`'s `BLOCKED_FILENAMES`, for the reason that a
 * gate living in the Uplink makes the first-party Uplinks less like the
 * third-party ones they model.
 *
 * And it would be nine copies of one assertion, each able to rot on its own.
 * The check does not need to be inside anything: it needs a place that already
 * imports every Uplink client legitimately and can also see `core`. That is
 * this package, which does both today, and where `main.tsx` already imports six
 * of the nine for real.
 *
 * So `classifyRequirement` does NOT need to move into `sitrep-sdk` for this
 * coverage to exist. It would need to move for an outside author to run the
 * same check on their own widgets, which is a separate and still-open question.
 *
 * ## What it asserts
 *
 * The registry, not the source. A regex over `dataRequirements:` arrays is how
 * the same vocabulary audit already went wrong in both directions at once,
 * matching mentions inside comments and missing every multi-line and
 * dynamically-built declaration. The registry is what the dashboard reads.
 *
 * An unresolvable entry is silent at runtime: `isTopicCarried` walks a field
 * path without checking that the leaf names a real field, so a typo renders as
 * a permanent `undefined` and costs the panel its stream-status badge and its
 * alarm matching. Nothing else can tell that from a value that has not arrived.
 */
describe("Uplink widget dataRequirements resolve to something real", () => {
  const declared = getComponents().flatMap((def) =>
    (def.dataRequirements ?? []).map((requirement) => ({
      id: def.id,
      requirement,
    })),
  );

  /**
   * The registry is global, so this sees the built-in widgets too if anything
   * in the import graph pulls `@ksp-gonogo/components` in. That is harmless
   * (the same assertion holds for them) but it means the count alone cannot
   * prove the Uplinks arrived, so the next test names them.
   */
  it("found a non-trivial number of declarations (scan sanity check)", () => {
    expect(declared.length).toBeGreaterThan(10);
  });

  /**
   * The guard on the guard, and the one that matters here. A side-effect import
   * that silently resolves to an empty module, or an Uplink that stops
   * registering its widget, leaves the assertion below true about nothing. So
   * the widgets have to be present by NAME.
   */
  it("actually loaded the Uplinks' own widgets, so an empty result is not a pass", () => {
    const ids = new Set(getComponents().map((def) => def.id));
    // One widget from each Uplink that registers any, spelled out rather than
    // counted: a count cannot tell nine loaded Uplinks from one loaded nine
    // times, and one client failing to register is precisely the case where an
    // empty check reads as a clean one.
    const fromUplinks = [
      "avionics-go-no-go",
      "robotics-console",
      "ship-systems",
      "camera-feed",
      "kos-terminal",
      "mechjeb",
      "scanning",
    ];
    const missing = fromUplinks.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
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
    // The classifier's own positive control, kept here as well as in the
    // components-side gate: if these stop holding, the assertion above is
    // passing because the classifier went permissive, not because the
    // declarations are sound.
    expect(
      classifyRequirement("career.status.economy.notAField"),
    ).toBeUndefined();
    expect(classifyRequirement("vessel.state.notAField")).toBeUndefined();
    expect(classifyRequirement("career.status")).toBe("wire-topic");
  });
});
