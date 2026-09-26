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

/** Comments mention the retired read form, so the scan reads code only. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Every `dataRequirements` and `fields` entry every built-in widget declares
 * must resolve to something real (`classifyRequirement` in
 * `@ksp-gonogo/core` has the four legal forms). `isTopicCarried` resolves a
 * path without checking the leaf, so a misspelt field would otherwise render
 * as a permanent `undefined`. Reads the real registry, not source text.
 *
 * Covers only the widgets this package registers. Uplink widgets and the
 * augment registry are checked by
 * `packages/app/src/__tests__/uplink-widget-declarations.test.ts`.
 */
describe("widget dataRequirements resolve to something real", () => {
  /**
   * `channels` and `optionalChannels` are left out: a built-in widget may
   * mount on an Uplink-owned channel that only resolves once that Uplink's
   * client is loaded, which the app gate has.
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
    // An empty registry would make the assertion below vacuous.
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
    // Positive control: a kind here means the classifier has gone permissive.
    expect(
      classifyRequirement("career.status.economy.notAField"),
    ).toBeUndefined();
    expect(classifyRequirement("spaceCenter.state.notAField")).toBeUndefined();
    expect(classifyRequirement("career.status.economy.funds")).toBe(
      "field-path",
    );
    expect(classifyRequirement("career.status")).toBe("wire-topic");
    expect(classifyRequirement("spaceCenter.state")).toBe("derived-channel");
    // A retired flat-vocabulary key has nothing to resolve against.
    expect(classifyRequirement("career.funds")).toBeUndefined();
  });
});

describe("no built-in widget reads through the retired key vocabulary", () => {
  // What a widget reads, not declares: the two-arg `useTelemetry("data", key)` form takes an unchecked string, and for built-in widgets it is not used at all.
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
