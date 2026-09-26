// biome-ignore-all lint/suspicious/noTemplateCurlyInString: every fixture below
// is SOURCE TEXT containing the pattern under test. A `${...}` inside a plain
// string is normally a missing backtick; here it is the offence the guard
// exists to find, and writing it as a real template literal would interpolate
// it away.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  expectNoHandTypedUnits,
  findHandTypedUnits,
  HAND_TYPED_SYMBOLS,
} from "./guards";

/*
 * Every case that asserts the scan is quiet is paired with one that asserts it
 * is loud, so no assertion can pass against a shape that could never match.
 */

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "guards-"));
  roots.push(root);
  for (const [name, body] of Object.entries(files)) {
    const full = join(root, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

// 30s, not the 10s default: `rmSync` on a temp dir can exceed the default hook timeout under heavy disk I/O.
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
}, 30_000);

describe("findHandTypedUnits", () => {
  it("finds a symbol typed after an interpolation", () => {
    const dir = fixture({
      "Speed.tsx": "const label = `${speed.toFixed(1)} m/s`;\n",
    });
    const found = findHandTypedUnits({ dir });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      file: "Speed.tsx",
      line: 1,
      symbol: "m/s",
    });
  });

  it("reports the LONGEST symbol, not the first letter of it", () => {
    // `m/s` starts with `m`; reporting the short one would name the wrong unit.
    const dir = fixture({ "a.ts": "`${v} m/s`\n" });
    expect(findHandTypedUnits({ dir })[0].symbol).toBe("m/s");
  });

  it("says nothing about a readout that goes through <Unit>", () => {
    const dir = fixture({
      "Speed.tsx": '<Unit value={value("m/s", speed)} />\n',
    });
    expect(findHandTypedUnits({ dir })).toEqual([]);
  });

  it("ignores a CSS length, which is not a readout", () => {
    const dir = fixture({
      "Bar.tsx": [
        "const s = { width: `${pct}%` };",
        "const t = `translate(${x}%)`;",
        "<stop offset={`${stop}%`} />",
      ].join("\n"),
    });
    expect(findHandTypedUnits({ dir })).toEqual([]);
  });

  it("ignores a colour function, which is a CSS value not a readout", () => {
    const dir = fixture({
      "Colour.tsx": [
        "const fill = `hsl(${hue}deg ${sat}% ${light}%)`;",
        "const bg = `rgb(${r} ${g} ${b})`;",
      ].join("\n"),
    });
    expect(findHandTypedUnits({ dir })).toEqual([]);
  });

  it("still catches a percentage that IS a readout", () => {
    // The CSS filter must not be so broad that a real percentage readout slips through.
    const dir = fixture({ "Coverage.tsx": "<span>{`${pct}%`}</span>\n" });
    expect(findHandTypedUnits({ dir })[0].symbol).toBe("%");
  });

  it("ignores a symbol that appears in prose", () => {
    // A file explaining the rule should not be its own first offender.
    const dir = fixture({
      "Doc.tsx": [
        "// Never write `${speed.toFixed(1)} m/s` by hand.",
        "/* Nor `${alt} km` in a block comment. */",
        "/**",
        " * Nor `${mass} kg` in a doc comment.",
        " */",
        "const ok = 1;",
      ].join("\n"),
    });
    expect(findHandTypedUnits({ dir })).toEqual([]);
  });

  it("still catches code on a line that also carries a comment", () => {
    // Blanking comments must not blank the code beside them.
    const dir = fixture({ "Mixed.tsx": "const l = `${v} km`; // a label\n" });
    expect(findHandTypedUnits({ dir })).toHaveLength(1);
  });

  it("catches code AFTER a block comment closes", () => {
    const dir = fixture({ "After.tsx": "/* prose */ const l = `${v} km`;\n" });
    expect(findHandTypedUnits({ dir })).toHaveLength(1);
  });

  it("skips tests, snapshots and build output", () => {
    const dir = fixture({
      "a.test.tsx": "`${v} km`\n",
      "b.spec.ts": "`${v} km`\n",
      "__snapshots__/c.snap": "`${v} km`\n",
      "dist/d.js": "`${v} km`\n",
      "node_modules/pkg/e.js": "`${v} km`\n",
    });
    expect(findHandTypedUnits({ dir })).toEqual([]);
  });

  it("takes a symbol the kit has never heard of", () => {
    // An Uplink can `registerUnit` its own, so the guard has to be able to look for it.
    const dir = fixture({ "Reactor.tsx": "`${flux} Sv`\n" });
    expect(findHandTypedUnits({ dir })).toEqual([]);
    expect(
      findHandTypedUnits({ dir, symbols: [...HAND_TYPED_SYMBOLS, "Sv"] }),
    ).toHaveLength(1);
  });

  it("honours an ignore predicate", () => {
    const dir = fixture({ "legacy/Old.tsx": "`${v} km`\n" });
    expect(findHandTypedUnits({ dir })).toHaveLength(1);
    expect(
      findHandTypedUnits({ dir, ignore: (f) => f.startsWith("legacy/") }),
    ).toEqual([]);
  });
});

describe("expectNoHandTypedUnits", () => {
  it("passes on a clean tree", () => {
    const dir = fixture({ "Speed.tsx": "<Unit value={speed} />\n" });
    expect(() => expectNoHandTypedUnits({ dir })).not.toThrow();
  });

  it("throws, and names the file, the line and the fix", () => {
    const dir = fixture({ "Speed.tsx": "\nconst l = `${v} m/s`;\n" });
    expect(() => expectNoHandTypedUnits({ dir })).toThrow(/Speed\.tsx:2/);
    expect(() => expectNoHandTypedUnits({ dir })).toThrow(/<Unit value=/);
    // The message names the sanctioned escapes.
    expect(() => expectNoHandTypedUnits({ dir })).toThrow(/speakQuantity/);
  });

  /** The symbol list is the guard's whole reach, so a unit missing from it is not caught. */
  it("sees the units added after the list was measured", () => {
    for (const source of [
      "`${v} rpm`",
      "`${v} dB`",
      "`${v} Pa`",
      "`${v} rad/s`",
      "`${v} m²`",
    ]) {
      const dir = fixture({ "Readout.tsx": `${source}\n` });
      expect(() => expectNoHandTypedUnits({ dir }), source).toThrow(
        /Readout\.tsx:1/,
      );
    }
  });

  /** Case is significant, since single-letter members would otherwise match prose and CSS. */
  it("matches a unit case-sensitively, so both spellings must be listed", () => {
    const upper = fixture({ "Rotor.tsx": "`${v} RPM`\n" });
    expect(() => expectNoHandTypedUnits({ dir: upper })).toThrow(
      /Rotor\.tsx:1/,
    );

    // Not on the list in this spelling, and so not seen: one spelling does not cover another.
    const unlisted = fixture({ "Rotor.tsx": "`${v} Rpm`\n" });
    expect(() => expectNoHandTypedUnits({ dir: unlisted })).not.toThrow();
  });

  it("stays quiet for a file at its baseline", () => {
    const dir = fixture({ "Old.tsx": "`${v} km`\n" });
    expect(() =>
      expectNoHandTypedUnits({ dir, baseline: { "Old.tsx": 1 } }),
    ).not.toThrow();
  });

  it("throws when a file goes ABOVE its baseline", () => {
    const dir = fixture({ "Old.tsx": "`${v} km`\n`${w} kg`\n" });
    expect(() =>
      expectNoHandTypedUnits({ dir, baseline: { "Old.tsx": 1 } }),
    ).toThrow(/Old\.tsx:2/);
  });

  it("throws when a file drops BELOW its baseline", () => {
    // A stale allowance would let the symbol come back to that file unnoticed.
    const dir = fixture({ "Old.tsx": "<Unit value={v} />\n" });
    expect(() =>
      expectNoHandTypedUnits({ dir, baseline: { "Old.tsx": 2 } }),
    ).toThrow(/now 0, baseline 2/);
  });
});
