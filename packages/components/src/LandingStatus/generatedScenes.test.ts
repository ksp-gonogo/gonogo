import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  generatedScenes,
  isRecord,
} from "../../scripts/gen-landing-status-fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where two parsed scenes first differ, or null: every value exactly, keys in order. */
function firstDifference(
  committed: unknown,
  generated: unknown,
  at: string,
): string | null {
  if (Array.isArray(committed) && Array.isArray(generated)) {
    if (committed.length !== generated.length) {
      return `${at}: committed has ${committed.length} entries, generated ${generated.length}`;
    }
    for (let i = 0; i < committed.length; i++) {
      const found = firstDifference(committed[i], generated[i], `${at}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (isRecord(committed) && isRecord(generated)) {
    const keys = Object.keys(committed);
    if (keys.join(",") !== Object.keys(generated).join(",")) {
      return `${at}: committed keys ${keys.join(",")}, generated ${Object.keys(generated).join(",")}`;
    }
    for (const key of keys) {
      const found = firstDifference(
        committed[key],
        generated[key],
        `${at}.${key}`,
      );
      if (found) return found;
    }
    return null;
  }
  return Object.is(committed, generated)
    ? null
    : `${at}: committed ${JSON.stringify(committed)}, generated ${JSON.stringify(generated)}`;
}

/**
 * The scenes the generators write are the committed files: a regeneration changes nothing, so a figure fixed in a generator reaches every scene and a hand edit to a scene is caught here rather than lost on the next run.
 * To change a scene, change its generator and run `scripts/gen-landing-status-fixtures.ts`, then format.
 */
describe("generated Landing Status scenes", () => {
  const scenes = generatedScenes();

  it("covers every scene the generators own", () => {
    expect(scenes.map((s) => s.path).sort()).toEqual([
      "__fixtures__/descending-too-fast-to-stop.json",
      "__fixtures__/final-approach-mun.json",
      "__fixtures__/kerbin-reentry-atmospheric.json",
      "__fixtures__/landed-mun.json",
      "__fixtures__/pre-burn-cruise.json",
      "__fixtures__/suicide-burn-approaching-link-lost.json",
      "__fixtures__/suicide-burn-approaching.json",
      "__render__/descent-approach.json",
      "__render__/descent-final.json",
      "__render__/descent-high.json",
      "__render__/descent-ignition.json",
      "__render__/descent-landed.json",
      "__render_atmospheric__/final-approach-chute.json",
      "__render_currency__/live-descent.json",
      "__render_currency__/no-link.json",
      "__render_currency__/readings-gone-stale-mid-descent.json",
      "__render_terrains__/boulder-rough.json",
      "__render_terrains__/crater-field.json",
      "__render_terrains__/flat-plains.json",
      "__render_terrains__/gentle-slope.json",
      "__render_terrains__/ridge-mountainous.json",
      "__render_terrains__/steep-slope.json",
    ]);
  });

  it.each(
    generatedScenes().map((s) => [s.path, s.fixture] as const),
  )("%s is what its generator writes", (path, fixture) => {
    const committed = JSON.parse(readFileSync(resolve(HERE, path), "utf8"));
    expect(firstDifference(committed, fixture, path)).toBeNull();
  });

  it("is the same file on a machine whose maths library differs in the last digits", () => {
    const names = [
      "sin",
      "cos",
      "tan",
      "atan2",
      "atan",
      "asin",
      "acos",
      "exp",
      "log",
      "sqrt",
      "hypot",
      "pow",
    ] as const;
    const originals = names.map((name) => Math[name]);
    let state = 12345;
    // Up to two units in the last place either way, from a fixed sequence.
    const noisy = (x: number) => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      const ulps = Math.floor((state / 4294967296) * 5) - 2;
      return Number.isFinite(x) && x !== 0 ? x * (1 + ulps * 2 ** -52) : x;
    };
    try {
      names.forEach((name, i) => {
        const original = originals[i] as (...args: number[]) => number;
        Object.defineProperty(Math, name, {
          configurable: true,
          writable: true,
          value: (...args: number[]) => noisy(original(...args)),
        });
      });
      for (const { path, fixture } of generatedScenes()) {
        const committed = JSON.parse(readFileSync(resolve(HERE, path), "utf8"));
        expect(firstDifference(committed, fixture, path)).toBeNull();
      }
    } finally {
      names.forEach((name, i) => {
        Object.defineProperty(Math, name, {
          configurable: true,
          writable: true,
          value: originals[i],
        });
      });
    }
  });
});
