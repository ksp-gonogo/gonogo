import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generatedScenes } from "../../scripts/gen-landing-status-fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));

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
    // Compared as text so the order of keys, which the committed files keep, counts too.
    expect(JSON.stringify(committed)).toBe(JSON.stringify(fixture));
  });
});
