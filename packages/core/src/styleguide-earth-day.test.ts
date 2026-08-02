import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
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
 * **Test files are exempt.** A `const DAY = 86400` in an orbital-mechanics test
 * is an input magnitude for maths that works in raw seconds and has no calendar
 * in it; the value is arbitrary there and carries no claim about Kerbin.
 *
 * Scans git-tracked files so it respects `.gitignore`, same approach as
 * `styleguide-emdash.test.ts` and `uplink-boundary.test.ts`.
 */

const EARTH_DAY = "86400";

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
    file.includes("/dist/")
  );
}

function trackedFilesWithEarthDay(root: string): string[] {
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["grep", "-Il", EARTH_DAY, "--", "packages", "mod"],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
    );
  } catch (err) {
    // git grep exits 1 when nothing matches anywhere.
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
  return out.split("\n").filter(Boolean);
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

describe("design-system: the KSP day", () => {
  it("no shipped source divides or multiplies by an Earth day", () => {
    const offenders = trackedFilesWithEarthDay(root).filter(
      (f) => !isExempt(f),
    );
    if (offenders.length > 0) {
      throw new Error(
        `Found 86400 in ${offenders.length} shipped file(s). A KSP day is 6 ` +
          "hours (21,600s), not 24. Import KSP_DAY_SECONDS from " +
          "@ksp-gonogo/ui-kit, or pass the seconds to formatDuration / " +
          `formatCountdown and skip the arithmetic. Offenders:\n${offenders
            .map((f) => `  ${f}`)
            .join("\n")}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });
});
