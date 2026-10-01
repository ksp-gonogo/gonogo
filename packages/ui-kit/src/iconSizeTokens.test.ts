import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, p), "utf8");

/**
 * An icon's default size is a `var()` inside the SVG `width`/`height`
 * presentation attribute. It resolves in all three engines, and it steps under
 * `@media (pointer: coarse)`, which a JS number cannot.
 */
describe("icon size tokens", () => {
  it("the kit's icon defaults reach for the token, not a number", () => {
    expect(read("./Icons.tsx")).toMatch(/size:\s*"var\(--icon-size-control\)"/);
    expect(read("./MarkerIcons.tsx")).toMatch(
      /DEFAULT_SIZE\s*=\s*"var\(--icon-size-(control|standalone)\)"/,
    );
  });

  it("a Fab sizes its own glyph to the standalone token", () => {
    expect(read("../../ui/src/Fab.tsx")).toMatch(
      /& > svg \{[^}]*var\(--icon-size-standalone\)/,
    );
  });

  it("both icon sizes step on a coarse pointer", () => {
    const tokens = read("../../theme/src/tokens.css");
    const coarse = tokens.slice(tokens.indexOf("@media (pointer: coarse)"));
    for (const name of ["--icon-size-control", "--icon-size-standalone"]) {
      expect(tokens).toMatch(new RegExp(`^\\s*${name}:\\s*\\d+px;`, "m"));
      expect(coarse).toContain(name);
    }
  });

  it("the icon family stays off the type scale", () => {
    // A type token offered for a box dimension gets reached for as text.
    expect(read("./Icons.tsx")).not.toMatch(/size:\s*"var\(--font-size-/);
    expect(read("./MarkerIcons.tsx")).not.toMatch(
      /DEFAULT_SIZE\s*=\s*"var\(--font-size-/,
    );
  });
});
