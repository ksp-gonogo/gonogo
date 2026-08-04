import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: **86,400 is not a day here.**
 *
 * Stock KSP runs on Kerbin time: a day is 6 hours (21,600s) and a year is 426
 * of those days. Every duration on the wire arrives in SI seconds, so any code
 * that wants to say "days" has to divide by something, and `86400` is the
 * number a hand rolls out of habit. It is wrong by a factor of four, silently,
 * and it renders as a plausible number rather than as an obvious fault.
 *
 * This existed in four widgets at once when the guard was written:
 * `CrewManifest` and `LifeSupportSystems` both said "Xd Yh to depletion" on an
 * Earth calendar while the mission clock beside them counted Kerbin days;
 * `TransferWindow` quoted transfer durations and a `/365` year on top of the
 * same error; `GreenhouseSection` scaled a per-second crop rate to a
 * twenty-four-hour "per day". A crew readout claiming three days of oxygen when
 * eighteen Kerbin hours remain is the specific failure this prevents.
 *
 * The fix is always the same: import `KSP_DAY_SECONDS` / `KSP_YEAR_DAYS` from
 * `@ksp-gonogo/ui-kit`, or better, hand the seconds to `formatDuration` /
 * `formatCountdown` and do no arithmetic at all.
 *
 * ## Two holes this used to have
 *
 * It matched the literal string `86400`, which meant **numeric separators evaded
 * it entirely**: `86_400` and `86_400_000` are the same mistake spelled in the
 * style this repo actually writes large numbers in, and neither was caught. The
 * millisecond form is the one that matters most, because a wall-clock age in
 * milliseconds is exactly where a hand reaches for it.
 *
 * It also matched inside COMMENTS, so a file explaining why a KSP day is not
 * 86,400 seconds failed the guard for saying so. Comments and string literals
 * are stripped before the scan now, which fixes that and makes the offender
 * report a line number rather than a filename.
 *
 * **Test files are exempt.** A `const DAY = 86400` in an orbital-mechanics test
 * is an input magnitude for maths that works in raw seconds and has no calendar
 * in it; the value is arbitrary there and carries no claim about Kerbin.
 *
 * Scans git-tracked files so it respects `.gitignore`, same approach as
 * `styleguide-emdash.test.ts` and `uplink-boundary.test.ts`.
 */

/**
 * 86400, 86_400, and the millisecond forms of each. Written as one pattern
 * rather than a list so a new spelling has to be deliberate.
 */
const EARTH_DAY = /\b86_?400(?:_?000)?\b/;
/** The `git grep -E` form of the above; POSIX ERE has no non-capturing group. */
const EARTH_DAY_GREP = "\\b86_?400(_?000)?\\b";

/**
 * Files whose 24-hour day is CORRECT because the thing being measured is real
 * time, not game time.
 *
 * **Empty, and the fix this list was waiting for is the reason.** It held one
 * entry, `core`'s `formatAge`, which measures how long ago a reading was seen
 * and is therefore counting the operator's afternoon rather than Kerbin's
 * rotation. The note on it said the proper fix was for the value to carry
 * `irlTime` as its dimension, at which point the distinction would stop being
 * a matter of which file the arithmetic sits in. That is what happened: `irl:s`
 * is a unit like any other, `formatQuantity` ladders it on a real day, and the
 * two wall-clock readouts in the app hand it a value instead of dividing.
 *
 * So a new entry here should be rare, and the question to ask before adding
 * one is whether the value could carry `irl:s` instead.
 */
const WALL_CLOCK_EXEMPT: Array<{ file: string; why: string }> = [];

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

function isExempt(file: string): boolean {
  return (
    file.includes(".test.") ||
    file.includes(".spec.") ||
    file.endsWith(".snap") ||
    file.includes("/__generated__/") ||
    file.includes("/dist/") ||
    WALL_CLOCK_EXEMPT.some((entry) => file.endsWith(entry.file))
  );
}

/**
 * Blanks out comments and string literals, preserving line structure so the
 * reported line numbers still point at the source.
 *
 * Not a parser, and it does not need to be: it only has to stop prose about the
 * number from reading as a use of the number. Over-blanking would at worst hide
 * a real offender inside a string, and a duration in a string literal is not
 * arithmetic.
 */
function stripCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;
  let state: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (char === "/" && next === "/") {
        state = "line";
        out += "  ";
        i += 2;
        continue;
      }
      if (char === "/" && next === "*") {
        state = "block";
        out += "  ";
        i += 2;
        continue;
      }
      if (char === "'" || char === '"' || char === "`") {
        state = char;
        out += " ";
        i += 1;
        continue;
      }
      out += char;
      i += 1;
      continue;
    }
    if (state === "line") {
      if (char === "\n") {
        state = "code";
        out += "\n";
      } else {
        out += " ";
      }
      i += 1;
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        state = "code";
        out += "  ";
        i += 2;
        continue;
      }
      out += char === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    // Inside a string literal.
    if (char === "\\") {
      out += "  ";
      i += 2;
      continue;
    }
    if (char === state) {
      state = "code";
    }
    out += char === "\n" ? "\n" : " ";
    i += 1;
  }
  return out;
}

function candidateFiles(root: string): string[] {
  try {
    return execFileSync(
      "git",
      ["grep", "-IlE", EARTH_DAY_GREP, "--", "packages", "mod"],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
    )
      .split("\n")
      .filter(Boolean);
  } catch (err) {
    // git grep exits 1 when nothing matches anywhere.
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
}

/** `path:line` for every real use, comments and strings already discounted. */
function earthDayOffenders(root: string): string[] {
  const offenders: string[] = [];
  for (const file of candidateFiles(root).filter((f) => !isExempt(f))) {
    const code = stripCommentsAndStrings(
      readFileSync(join(root, file), "utf8"),
    );
    code.split("\n").forEach((line, index) => {
      if (EARTH_DAY.test(line)) {
        offenders.push(`${file}:${index + 1}`);
      }
    });
  }
  return offenders;
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

describe("design-system: the KSP day", () => {
  it("no shipped source divides or multiplies by an Earth day", () => {
    const offenders = earthDayOffenders(root);
    if (offenders.length > 0) {
      throw new Error(
        `Found an Earth day in ${offenders.length} place(s). A KSP day is 6 ` +
          "hours (21,600s), not 24. Import KSP_DAY_SECONDS from " +
          "@ksp-gonogo/ui-kit, or pass the seconds to formatDuration / " +
          `formatCountdown and skip the arithmetic. Offenders:\n${offenders
            .map((f) => `  ${f}`)
            .join("\n")}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it("catches the separator spellings the string match missed", () => {
    // The hole that let `86_400_000` through. Each of these is the same mistake
    // written the way this repo writes large numbers.
    for (const spelling of ["86400", "86_400", "86400000", "86_400_000"]) {
      expect(EARTH_DAY.test(`const day = ${spelling};`)).toBe(true);
    }
    // Not a substring match: a longer number that merely contains the digits is
    // not a day.
    expect(EARTH_DAY.test("const id = 186400123;")).toBe(false);
  });

  it("does not fire on prose about the number", () => {
    // A file explaining why a KSP day is not 86,400 seconds used to fail the
    // guard for saying so.
    const source = [
      "// A KSP day is 21600s, not 86400.",
      "/* also not 86_400_000 ms */",
      'const message = "not 86400";',
      "const day = 21_600;",
    ].join("\n");
    const stripped = stripCommentsAndStrings(source);
    expect(stripped.split("\n").some((l) => EARTH_DAY.test(l))).toBe(false);
    // Line structure survives, so reported line numbers still point at source.
    expect(stripped.split("\n")).toHaveLength(4);
  });

  it("still sees a real use on the line it is on", () => {
    const source = ["// comment", "const perDay = seconds / 86_400;"].join(
      "\n",
    );
    const lines = stripCommentsAndStrings(source).split("\n");
    expect(EARTH_DAY.test(lines[0])).toBe(false);
    expect(EARTH_DAY.test(lines[1])).toBe(true);
  });
});
