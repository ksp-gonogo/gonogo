import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: **a day is not a literal, either flavour.**
 *
 * Stock KSP runs on Kerbin time: a day is 6 hours (21,600s) and a year is 426
 * of those days. Every duration on the wire arrives in SI seconds, so any code
 * that wants to say "days" has to divide by something, and `86400` is the
 * number a hand rolls out of habit. It is wrong by a factor of four, silently,
 * and it renders as a plausible number rather than as an obvious fault.
 *
 * This existed in four widgets at once when the guard was written:
 * `CrewStatus` and `LifeSupportSystems` both said "Xd Yh to depletion" on an
 * Earth calendar while the mission clock beside them counted Kerbin days;
 * `TransferWindow` quoted transfer durations and a `/365` year on top of the
 * same error; `GreenhouseSection` scaled a per-second crop rate to a
 * twenty-four-hour "per day". A crew readout claiming three days of oxygen when
 * eighteen Kerbin hours remain is the specific failure this prevents.
 *
 * ## And 21,600 is not one either
 *
 * This guard originally caught only `86400`, because it was written to stop
 * people assuming EARTH. That left the opposite hole wide open: `21_600` is
 * Kerbin's rotation, and it is just as wrong the moment the game is not on
 * Kerbin time. Two situations make that ordinary rather than exotic:
 *
 * - `GameSettings.KERBIN_TIME` is a STOCK setting. Turn it off and KSP's own
 *   UI reads in 24-hour days; an app holding 21,600 disagrees with the game
 *   on the same screen.
 * - RSS and anything else on Kopernicus replaces `KSPUtil.dateTimeFormatter`
 *   outright.
 *
 * So the mod now publishes what the running game uses on `time.calendar`, and
 * BOTH literals are offences here. Two were found by widening this: a
 * ground-track horizon in `MapView` and a hand-rolled `Y# D#` clock in
 * `AlarmsModal` that also printed a literal "Y1" for every date.
 *
 * The fix is always the same: `kspCalendar()` from `@ksp-gonogo/ui-kit`, or
 * better, hand the seconds to `formatDuration` / `formatCountdown` /
 * `<MissionDate>` and do no arithmetic at all.
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
const EARTH_DAY = /\b(?:86_?400(?:_?000)?|21_?600)\b/;
/** The `git grep -E` form of the above; POSIX ERE has no non-capturing group. */
const EARTH_DAY_GREP = "\\b(86_?400(_?000)?|21_?600)\\b";

/**
 * Files whose 24-hour day is CORRECT because the thing being measured is real
 * time, not game time.
 *
 * **Two entries, both DEFINITION SITES rather than assumptions.** It briefly
 * held none, after `formatAge` moved to `irl:s`. Widening this guard to catch
 * a hardcoded KERBIN day (see the header) then caught the two places that are
 * allowed to write a day length down: the calendar fallback itself, and the
 * declared unit ratio the live calendar overrides. Neither divides by the
 * number; both are where the number lives.
 *
 * The history below is worth keeping, because it is the reason the list
 * exists at all. It held one
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
const WALL_CLOCK_EXEMPT: Array<{ file: string; why: string }> = [
  {
    file: "mod/sitrep-sdk/src/unit-system/calendar.ts",
    why:
      "THE definition site. `STOCK_KERBIN_CALENDAR` is where 21,600 and 426 " +
      "are written down, once, as the FALLBACK every other module reads " +
      "through `kspCalendar()`. A guard that fails the one file allowed to " +
      "say the number is a guard with nowhere to put the number.\n" +
      "It used to be `packages/ui-kit/src/kspTime.ts`, and this guard is how " +
      "the move was noticed: the kit could only reach its own formatters, so " +
      "`Value` arithmetic never saw the calendar and `.in('d')` answered 4 " +
      "for an Earth day. The calendar belongs to the unit model, below both " +
      "consumers. kspTime.ts is now a re-export and holds no number, which " +
      "is why it is no longer listed here.",
  },
  {
    file: "mod/sitrep-sdk/src/unit-system/definitions.ts",
    why:
      "The declared unit model: `d` has a ratio, and the stock ratio is one " +
      "Kerbin rotation. `ratioOf` overrides it from the live calendar at " +
      "runtime (see CALENDAR_RATIO in the calendar module above, which both " +
      "`Value` arithmetic and `formatQuantity` now read), so this is the " +
      "default the override starts from rather than an assumption anyone " +
      "divides by.",
  },
];

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
    // C# test projects, which name their files `FooTests.cs` rather than
    // `foo.test.cs`. A day length in one of those is fixture data: the
    // calendar tests exist precisely to feed the producer a 21,600 and an
    // 86,400 and check it carries whichever it was given.
    file.includes("Tests/") ||
    file.endsWith("Tests.cs") ||
    file.endsWith(".snap") ||
    // Recorded fixtures are captures of a real game, not arithmetic. A
    // Kerbin-synchronous orbit fixture holds 21,600 because that is what the
    // game said when it was recorded.
    file.includes("/__fixtures__/") ||
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
    for (const spelling of [
      "86400",
      "86_400",
      "86400000",
      "86_400_000",
      // Kerbin's rotation is a hardcoded day too, and was invisible to this
      // guard for its whole life.
      "21600",
      "21_600",
    ]) {
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
      "// and 21_600 in a comment is still prose",
    ].join("\n");
    const stripped = stripCommentsAndStrings(source);
    expect(stripped.split("\n").some((l) => EARTH_DAY.test(l))).toBe(false);
    // Line structure survives, so reported line numbers still point at source.
    expect(stripped.split("\n")).toHaveLength(4);
  });

  it("still sees a real KERBIN day, which it used to walk straight past", () => {
    // `const day = 21_600;` sat in the prose fixture above as an ALLOWED
    // example for this guard's whole life, because it only ever looked for
    // Earth. It is an offence now: hardcoding Kerbin's rotation is wrong the
    // moment the game is not on Kerbin time.
    const stripped = stripCommentsAndStrings("const day = 21_600;");
    expect(EARTH_DAY.test(stripped)).toBe(true);
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
