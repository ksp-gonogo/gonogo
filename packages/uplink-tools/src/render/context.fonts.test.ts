import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JETBRAINS_MONO_WEIGHTS, jetbrainsMonoFace } from "./context";

const APP_FONTS_CSS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../app/src/styles/fonts.css",
);

describe("jetbrainsMonoFace", () => {
  it("inlines the same weights the app self-hosts", () => {
    const appWeights = [
      ...readFileSync(APP_FONTS_CSS, "utf8").matchAll(
        /@import\s+"@fontsource\/jetbrains-mono\/(\d+)\.css"/g,
      ),
    ].map((m) => Number(m[1]));
    expect(appWeights.length).toBeGreaterThan(0);
    expect([...JETBRAINS_MONO_WEIGHTS]).toEqual(appWeights);
  });

  it("covers every subset at every weight, each scoped to its own range", () => {
    const face = jetbrainsMonoFace();
    expect(face.mode).toBe("locked");
    const rules = face.css.split("\n");
    for (const weight of JETBRAINS_MONO_WEIGHTS) {
      const atWeight = rules.filter((r) =>
        r.includes(`font-weight:${weight};`),
      );
      // latin, latin-ext, greek, cyrillic, cyrillic-ext, vietnamese
      expect(atWeight).toHaveLength(6);
      for (const rule of atWeight) expect(rule).toMatch(/unicode-range:U\+/);
      // The Greek subset, which carries the Δ of every ΔV readout
      expect(atWeight.some((r) => r.includes("U+038E-03A1"))).toBe(true);
    }
  });
});
