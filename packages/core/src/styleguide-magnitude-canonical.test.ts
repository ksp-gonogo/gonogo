import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * One implementation of "take a quantity's magnitude", and this is what keeps
 * it at one.
 *
 * `styleguide-magnitude-budget.test.ts` next door COUNTS unwraps. It cannot
 * read what an unwrap answers, and that is the gap this exists to close. The
 * Kerbalism Uplink carried its own `mag()` beside its own `Quantityish`, and
 * the copy differed from the canonical pair in exactly one respect: it
 * returned `0` where `magnitudeOf` returns `null`, and its `magnitude` was
 * optional so anything satisfied it. The budget was green throughout, because
 * the copy spent exactly one `.magnitude` and forty-one call sites spent none.
 *
 * What forty-one call sites got instead was a LIFE SUPPORT panel where a
 * habitat payload that never arrived rendered as "not pressurised", a
 * spaceweather frame with no dose rate rendered as "0.000 rad/h", and an
 * unreported comfort factor rendered as a warning-toned empty bar. Every one
 * of those is a reading an operator would act on, and none of them was a
 * reading at all.
 *
 * A count could never have seen that. What CAN see it is the shape the second
 * copy took, which is the shape every second copy takes: it declared the
 * canonical names again, locally. So that is what this checks, and the fix it
 * asks for is always the same one line: import from `@ksp-gonogo/ui-kit`.
 *
 * A file that wants a NARROWER type may still alias one (`LandingStatus`
 * parameterises `Quantityish` by unit so a speed cannot be passed to a length
 * readout). Aliasing a type is not reimplementing the unwrap, and only the
 * FUNCTIONS are held to one declaration here.
 */

/** The one file allowed to declare them. */
const CANONICAL = "mod/sitrep-sdk/src/magnitude.ts";

/**
 * One file, and it is a deliberate hold rather than a layering problem now.
 *
 * The canonical pair moved down into `mod/sitrep-sdk/src/magnitude.ts` on
 * 2026-08-25, so the cycle that used to make every sdk file unable to converge
 * is gone and `vessel-state.ts` converged with it. `orbit-trajectory.ts` did
 * not, because its local copy is the only one whose absence answer is THROW,
 * and nobody has established what a thrown `TypeError` inside that derive
 * actually does to a render. This project prefers loud to silent, so the throw
 * may well be correct as it stands, and swapping it for a NaN on the way past
 * would be a behaviour change with no evidence behind it.
 *
 * What it needs is a reproduction: a wire trajectory with a missing point
 * component, and a look at where the throw lands. Then either converge it or
 * write down why it stays. Until then this entry is the reason, not a gap.
 */
const HELD = new Set(["mod/sitrep-sdk/src/spine/orbit-trajectory.ts"]);

/**
 * Names a second copy reaches for. `mag` is on the list because it is what the
 * Kerbalism copy was actually called: a shortened spelling of the canonical
 * name is the commonest way a duplicate arrives, since the author knows what
 * they want and does not know it already exists.
 */
const RESERVED = ["magnitudeOf", "magnitudeOr", "mag"];

/**
 * A DECLARATION of one of those names, not a call or an import: `function
 * magnitudeOf(`, `const mag = (`, `let magnitudeOr = function`. Written as one
 * alternation so a single `git grep` covers both forms.
 *
 * No `\b`: `git grep -E` does not take it (the budget's own regex returned zero
 * matches on that mistake first time). The `(^|[^A-Za-z0-9_$])` prefix does the
 * same job, and keeps `writeMagnitudeOf` from matching `magnitudeOf`.
 */
const DECLARATION = String.raw`(^|[^A-Za-z0-9_$])(function|const|let|var)[ \t]+(${RESERVED.join("|")})[ \t]*[=(]`;

/**
 * The same property access the budget counts, and the reason this check needs
 * it: `mag` is also the ordinary name for a VECTOR magnitude, and four files
 * declare one over `Math.hypot` or `Math.abs` with no wire quantity in sight.
 * A name alone cannot tell those from a second unwrap. A file that reads
 * `.magnitude` somewhere can, which makes the pair of signals the test: the
 * name says what the helper is for, the access says it is about a quantity.
 *
 * The `]` comes FIRST inside the bracket expression because POSIX has no
 * escaping in there, the same trap the budget's own regex documents.
 */
const PROPERTY_ACCESS = String.raw`[]A-Za-z0-9_$)?]\.magnitude`;

const SEARCH_GLOBS = ["*.ts", "*.tsx"];

/**
 * Excluded: build output, tests and fixtures (a test may name a local stub
 * whatever it likes), and generated contract code.
 */
const EXCLUDED = /\/dist\/|\.test\.|\.spec\.|test-d|__fixtures__|__generated__/;

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

/** `git grep -nE`, with "no matches" reported as no matches rather than thrown. */
function grep(root: string, pattern: string): string[] {
  try {
    return execFileSync(
      "git",
      // `--untracked` for the same reason the budget uses it: a brand-new file
      // is invisible to `git grep` until it is staged, so a local run before
      // `git add` would report success while not looking at the copy.
      ["grep", "--untracked", "-nE", pattern, "--", ...SEARCH_GLOBS],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 },
    ).split("\n");
  } catch (err) {
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
}

function fileOf(line: string): string | undefined {
  if (!line || EXCLUDED.test(line)) return undefined;
  const file = line.slice(0, line.indexOf(":"));
  return file || undefined;
}

/**
 * Files that both declare a reserved name AND unwrap a magnitude, with the
 * declaration lines for the failure message. Either signal alone is noise; the
 * pair is a second implementation.
 */
function declarationsByFile(root: string): Map<string, string[]> {
  const unwrapping = new Set<string>();
  for (const line of grep(root, PROPERTY_ACCESS)) {
    const file = fileOf(line);
    if (file) unwrapping.add(file);
  }
  const found = new Map<string, string[]>();
  for (const line of grep(root, DECLARATION)) {
    const file = fileOf(line);
    if (!file || !unwrapping.has(file)) continue;
    const existing = found.get(file);
    if (existing) existing.push(line.trim());
    else found.set(file, [line.trim()]);
  }
  return found;
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

describe("the magnitude unwrap has exactly one implementation", () => {
  const found = declarationsByFile(root);

  /**
   * The guard on the guard, and it is not decoration: this exact search
   * returns nothing at all if the regex, the globs or the repo root are wrong,
   * and nothing at all reads as "no duplicates". So the check that must pass
   * first is that the search can still see the declaration it is built around.
   */
  it("can still see the canonical declaration, so a zero result means zero", () => {
    expect([...found.keys()]).toContain(CANONICAL);
    expect(found.get(CANONICAL)?.length).toBeGreaterThanOrEqual(2);
  });

  it("has no second implementation anywhere else", () => {
    const duplicates = [...found]
      .filter(([file]) => file !== CANONICAL && !HELD.has(file))
      .flatMap(([, lines]) => lines)
      .sort();
    if (duplicates.length > 0) {
      throw new Error(
        "A second magnitude unwrap. The canonical pair lives in " +
          `${CANONICAL} and is exported from @ksp-gonogo/ui-kit: import ` +
          "`magnitudeOf` (null when absent) or `magnitudeOr(v, fallback)` " +
          "(a stated default) instead of declaring one here. A local copy is " +
          "free to disagree about what absence means, and the last one " +
          "answered 0, which put unreported life-support readings on screen " +
          "as readings:\n" +
          duplicates.map((line) => `  ${line}`).join("\n"),
      );
    }
    expect(duplicates).toEqual([]);
  });
});
