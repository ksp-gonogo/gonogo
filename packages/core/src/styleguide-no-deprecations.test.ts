import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Pre-release guard: nothing in a PUBLISHED package is marked `@deprecated`.
 *
 * A deprecation is a promise to two parties: the author who keeps calling the
 * old thing, and the maintainer who eventually removes it. Neither party exists
 * yet. `@ksp-gonogo/sitrep-sdk` has been `0.0.1` on npm since 2026-07-11 and
 * `@ksp-gonogo/ui-kit` has been `0.1.0` since the same day, so every export
 * added since then has never reached a consumer and every export deleted since
 * then has broken nobody. There is no migration window to honour because there
 * is nobody inside it.
 *
 * What a deprecation costs instead: the first outside author to arrive reads a
 * tag saying "this is going away" with no version attached, cannot tell whether
 * the copy they installed is affected, and writes around a thing that was never
 * load-bearing. `Badge`'s `tone` was exactly that, documented as deprecated on
 * the public docs site while being the only prop the published package had.
 *
 * **This guard expires at release**, and deliberately does not try to detect
 * that itself: the moment there is a published version an author could be
 * pinned to, deleting an export silently breaks them and a dated deprecation
 * note becomes the humane path rather than debt. Delete this file then, in the
 * same change that cuts the release, rather than adding exemptions to it.
 *
 * Scope is the two published packages only. A private package can carry
 * whatever markers its own maintainers find useful; nobody outside can reach
 * them. Test and type-test files are out of scope for the same reason: `files`
 * is `["dist"]` in both manifests, so they are not in the tarball.
 *
 * Two instruments, because they fail differently. The source scan is a regex
 * over `src` and can be defeated by a spelling it does not expect. The `dist`
 * scan reads the `.d.ts` that actually ships, which is the only text an author
 * hovers, and is defeated instead by a stale build: it runs only when `dist`
 * is present, and says so when it is not.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

/** The packages with a `publishConfig.access` of `public`. */
const PUBLISHED = [
  join(REPO, "packages/ui-kit/src"),
  join(REPO, "mod/sitrep-sdk/src"),
];

const DEPRECATED_RE = /@deprecated/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|test-d|spec)\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/** Every `@deprecated` line in `dir`, as `path:line  text`. */
function deprecations(dir: string, extra?: string): string[] {
  const out: string[] = [];
  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      if (DEPRECATED_RE.test(line)) {
        out.push(`${relative(REPO, file)}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  if (extra !== undefined && DEPRECATED_RE.test(extra)) {
    out.push(`<planted>  ${extra.trim()}`);
  }
  return out;
}

describe("published packages carry no deprecations before release", () => {
  for (const dir of PUBLISHED) {
    const name = relative(REPO, dir);

    it(`${name} marks nothing @deprecated`, () => {
      const found = deprecations(dir);
      expect(
        found,
        "A published package is carrying a deprecation. Nothing has shipped " +
          "since 2026-07-11, so there is no consumer to migrate and no window " +
          "to honour: DELETE the export and its call sites instead, which is " +
          "free today and stops being free at release. If deletion is " +
          "genuinely unavailable, that is a decision for the operator rather " +
          "than a tag. Found:\n" +
          found.map((f) => `  ${f}`).join("\n"),
      ).toEqual([]);
    });
  }

  /**
   * The guard on the guard. Every assertion above passes on an empty result,
   * so a scan that silently reads nothing (a moved directory, a `readdirSync`
   * throwing into a swallowed catch) reports a clean tree and reads as success.
   * Feeding it a line it MUST match is the only assertion here able to tell
   * "no deprecations" from "no files".
   */
  it("can see a deprecation (planted)", () => {
    const planted = deprecations(PUBLISHED[0], " * @deprecated planted");
    expect(
      planted.some((f) => f.startsWith("<planted>")),
      "the matcher did not fire on a line that plainly contains the tag",
    ).toBe(true);
  });

  /**
   * The second instrument: the declarations an author actually hovers. Skipped
   * rather than failed when `dist` is absent, because a fresh clone has not
   * built yet and a guard that fails on that gets deleted.
   */
  for (const dir of PUBLISHED) {
    const dist = join(dir, "..", "dist");
    const name = relative(REPO, dir).replace(/\/src$/, "");

    it(`${name}'s shipped declarations carry no deprecation`, () => {
      if (!existsSync(dist)) {
        expect(
          existsSync(dist),
          `${name} is not built, so this instrument saw nothing. Run the ` +
            "build before trusting a clean result here.",
        ).toBe(false);
        return;
      }
      const found = sourceFiles(dist).filter((f) => f.endsWith(".d.ts"));
      const offenders = found
        .flatMap((file) =>
          readFileSync(file, "utf8")
            .split("\n")
            .map((line, i) => ({ file, i, line }))
            .filter(({ line }) => DEPRECATED_RE.test(line)),
        )
        .map(
          ({ file, i, line }) =>
            `${relative(REPO, file)}:${i + 1}  ${line.trim()}`,
        );
      expect(offenders, offenders.join("\n")).toEqual([]);
      expect(
        found.length,
        `${name}/dist holds no .d.ts, so this assertion passed vacuously`,
      ).toBeGreaterThan(0);
    });
  }

  it("actually reads files, so an empty result means clean", () => {
    for (const dir of PUBLISHED) {
      expect(
        sourceFiles(dir).length,
        `${relative(REPO, dir)} yielded no source files, so its assertion ` +
          "above passed vacuously",
      ).toBeGreaterThan(0);
    }
  });
});
