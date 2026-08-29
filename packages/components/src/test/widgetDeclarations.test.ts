import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRequirement, getComponents } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import "../index";

const COMPONENTS_SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function collectComponentSources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__fixtures__" || entry === "node_modules") continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push({ file: full, text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(COMPONENTS_SRC);
  return out;
}

/**
 * Comments mention the retired read form to record that it is gone, so a scan
 * that read them would report every such note as an offender.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

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
 * they are outside this file. The same assertion runs over them, and over the
 * separate augment registry, in
 * `packages/app/src/__tests__/uplink-widget-declarations.test.ts`: the app is
 * the one package that already depends on every Uplink client and can also see
 * `core`. That file's header says why the check does not live inside each
 * Uplink, which is a rule rather than an omission.
 */
describe("widget dataRequirements resolve to something real", () => {
  /**
   * `dataRequirements` and `fields`, which are the two arrays this package can
   * resolve on its own. `fields` is where a widget's field-granular declaration
   * lives, and it is exactly the vocabulary this gate was written to police, so
   * reading only `dataRequirements` would let the whole check drain away as
   * widgets migrate while still reporting green.
   *
   * `channels` and `optionalChannels` are deliberately NOT here, and the reason
   * is a limit of this package rather than a gap in the idea. A built-in widget
   * may mount on a channel an Uplink owns, and that topic id only becomes
   * resolvable once the owning Uplink's client registers it. Classified from
   * here that real channel reads as unresolvable, so widening this array would fail on
   * correct code and teach the next person to loosen the classifier. The app
   * gate named in the header does read all four, with every Uplink loaded,
   * which is the context where the answer is meaningful.
   */
  const declared = getComponents().flatMap((def) =>
    [...(def.dataRequirements ?? []), ...(def.fields ?? [])].map(
      (requirement) => ({
        id: def.id,
        requirement,
      }),
    ),
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
    // A key from the retired flat vocabulary. It resolved once, through a
    // migration table that no longer exists, and a declaration naming one now
    // has nothing to resolve against: exactly the answer a name nothing
    // publishes should get.
    expect(classifyRequirement("career.funds")).toBeUndefined();
  });
});

describe("no built-in widget reads through the retired key vocabulary", () => {
  // The registry check above sees what a widget DECLARES. This sees what it
  // READS, which is a separate way to name a retired key: the two-arg
  // `useTelemetry("data", key)` overload takes a string the type system never
  // checks, so a key that resolves to nothing there is a permanent `undefined`
  // with nothing to say so.
  //
  // Already at zero when this landed, and that is the point: the guarantee the
  // retired migration table's coverage gate carried was that every such read
  // resolved. With the table gone the only keys that form can still resolve are
  // an Uplink's dynamic namespaces, which live outside this package, so for
  // built-in widgets the honest rule is that the form is not used at all.
  const LEGACY_READ = /useTelemetry\(\s*"data"\s*,/g;

  const sources = collectComponentSources();

  it("finds the sources it claims to scan, so an empty result is not a pass", () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it("uses no two-arg useTelemetry read", () => {
    const offenders = sources
      .filter(({ text }) => stripComments(text).match(LEGACY_READ))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
