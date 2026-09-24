import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, p), "utf8");

/**
 * An icon's default size is written as a `var()` inside the SVG `width`/`height`
 * presentation attribute, which looks wrong enough that someone will want to put
 * a number back. It is not wrong, and these are the two reasons.
 *
 * It RESOLVES. Measured in chromium, firefox and webkit, with negative controls
 * so the measurement can show a failure: `width="banana"` is rejected by all
 * three and `width="var(--absent, 33px)"` renders at 33.
 *
 * It STEPS. `tokens.css` raises both icon sizes under `@media (pointer: coarse)`,
 * and a `size={20}` prop is a JS number that cannot read a media query. Replacing
 * the token with a number leaves the glyph behind on a touch screen while the
 * control around it grows, which is the defect the family exists to fix.
 */
describe("icon size tokens", () => {
  it("the kit's icon defaults reach for the token, not a number", () => {
    expect(read("./Icons.tsx")).toMatch(
      /size:\s*"var\(--icon-size-(control|standalone)\)"/,
    );
    expect(read("./MarkerIcons.tsx")).toMatch(
      /DEFAULT_SIZE\s*=\s*"var\(--icon-size-(control|standalone)\)"/,
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
    // A type name offered for a box dimension gets reached for as text, which
    // is the whole reason these two are not --font-size-*.
    expect(read("./Icons.tsx")).not.toMatch(/size:\s*"var\(--font-size-/);
    expect(read("./MarkerIcons.tsx")).not.toMatch(
      /DEFAULT_SIZE\s*=\s*"var\(--font-size-/,
    );
  });
});
