import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Two guards over the shape of a telemetry read, and both exist because `tsc` is
 * blind to the way this migration actually broke things.
 *
 * `useTelemetry` answers with a `Reading`. Every field access had to change, and the
 * compiler found all of those. What it could not find was a read handed to something
 * that accepts anything:
 *
 *     const instrumentsRaw = useTelemetry("science.instruments");   // a Reading
 *     const instruments = parseInstruments(instrumentsRaw);          // (raw: unknown)
 *
 * `parseInstruments` took the `Reading`, failed its own shape checks, returned
 * `null`, and the widget rendered "no instruments aboard" for a vessel full of them.
 * No type error anywhere, because `unknown` is a type that cannot express being given
 * the wrong thing. The same shape hid in `packages/app` and in the Uplink devkit,
 * where an `as` cast silenced it even harder: someone had asserted the old type.
 *
 * So this scans for the shape rather than trusting the types. It is deliberately a
 * DIFFERENT KIND of check from the compiler and from
 * `styleguide-reading-gates.test.ts` (which watches for a `Reading` used as a
 * truthiness gate): three instruments, three failure modes, and the day these were
 * written each of them caught something the other two could not see.
 */

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

function trackedSourceFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "packages", "mod", "--", "*.ts", "*.tsx"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return (
    out
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.includes("/__generated__/"))
      .filter((f) => !f.includes("/dist/"))
      // `git ls-files` reads the INDEX, so a file deleted but not yet staged is
      // still listed. Every ratchet in this repo that forgot that has reported the
      // committed past rather than the working tree; a developer running this before
      // committing wants the tree in front of them.
      .filter((f) => existsSync(join(root, f)))
  );
}

/**
 * A read whose result is passed on as a bare identifier rather than having a field
 * taken off it, and which never goes through one of the reading accessors.
 *
 * The accessors are the sanctioned narrowings (`judgeable`, `stillTrue`, `dateable`,
 * `withoutReckoning`, `readingAge`, `notCurrent`, `hasAnswered`), plus an explicit
 * branch on either discriminant, `.state` or `.reckoning`, which is what a widget
 * with its own rule writes.
 *
 * `hasAnswered` is the odd one out and worth a line: the others are per-site local
 * helpers matched by name, while it is exported from the SDK and shared. It answers
 * the presence-gate question ("has the producer spoken at all"), which the other
 * three do not, and it is shared precisely because five sites were answering it by
 * hand as `state !== "pending"` and every one of them read the `unowned` arm as the
 * producer having answered.
 */
const ACCESSORS =
  /judgeable|stillTrue|dateable|withoutReckoning|readingAge|notCurrent|hasAnswered/;

/**
 * The one sanctioned exception, with its reason.
 *
 * The probe render harness feeds widgets from recorded fixtures and reads
 * `<domain>.available` generically, by template-built topic id, for whatever domain a
 * fixture happens to carry. It is a dev-only harness, it is currently broken on
 * `staging` for an unrelated reason, and it is the one place where the read is
 * genuinely untyped by construction. Listed rather than silently skipped so that
 * "the harness is exempt" stays a decision someone made.
 */
const ALLOWED = new Set(["packages/components/scripts/probe/probe-entry.tsx"]);

/**
 * Names of functions declared in this file that take a `Reading`. Calling one is a
 * narrowing, because the parameter type is the thing that makes it safe.
 */
function localNarrowers(text: string): string[] {
  const names: string[] = [];
  const decl =
    /(?:function\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*:\s*Reading<|const\s+(\w+)\s*=\s*(?:<[^>]*>)?\s*\([^)]*:\s*Reading<)/g;
  let m: RegExpExecArray | null = decl.exec(text);
  while (m !== null) {
    const name = m[1] ?? m[2];
    if (name !== undefined) names.push(name);
    m = decl.exec(text);
  }
  return names;
}

interface Suspect {
  at: string;
  variable: string;
}

function bareReadings(sources: ReadonlyMap<string, string>): Suspect[] {
  const found: Suspect[] = [];
  for (const [file, text] of sources) {
    if (/\.test\.tsx?$|\.test-d\.tsx?$/.test(file)) continue;
    if (ALLOWED.has(file)) continue;
    if (!text.includes("useTelemetry(")) continue;
    const lines = text.split("\n");
    for (const [index, line] of lines.entries()) {
      const assigned = /const (\w+)\s*=\s*useTelemetry\([^)]*\)\s*;\s*$/.exec(
        line,
      );
      if (!assigned) continue;
      const variable = assigned[1];
      if (variable === undefined) continue;
      const rest = lines.slice(index + 1).join("\n");
      // Passed on whole: `f(x)`, `[x]`, `{ x }`, `return x`. A field access
      // (`x.foo` / `x?.foo`) would have been a type error, so it is not a risk.
      const bare = new RegExp(`[(,{}\\[\\s]${variable}(?![\\w.?])`).test(rest);
      if (!bare) continue;
      // `.reckoning` counts alongside `.state` because a `Reading` carries TWO
      // discriminants. A widget whose whole question is "is there a model" writes
      // only the second one, and reading it is as much a narrowing as reading the
      // first: both select union members. Matching only `.state` would report
      // such a site as a bare reading, which is a false accusation rather than a
      // missed one, but it teaches the reader that the scan does not know about
      // the second axis.
      const narrowed = new RegExp(
        `(?:${ACCESSORS.source})\\(\\s*${variable}|${variable}\\.(?:state|reckoning)`,
      ).test(rest);
      if (narrowed) continue;
      // A function declared IN THIS FILE that takes a `Reading` is a narrowing too.
      // A widget with its own rule writes one rather than reaching for a shared
      // accessor, and the receiver being typed `Reading<T>` is exactly what makes it
      // safe: the hazard this scan exists for is a receiver that accepts anything.
      if (
        localNarrowers(text).some((fn) =>
          new RegExp(`\\b${fn}\\(\\s*${variable}\\b`).test(rest),
        )
      ) {
        continue;
      }
      found.push({ at: `${file}:${index + 1}`, variable });
    }
  }
  return found;
}

/**
 * A presence gate written as `reading.state !== "pending"`.
 *
 * The trap this catches is specific and it has already been sprung once, on five
 * sites at once. Each asked "has the producer spoken at all", each reasoned that
 * `pending` was the only answer meaning nothing is there, and each was right until
 * the `unowned` arm existed. From that moment the same expression reads the
 * STRONGEST evidence of no producer as the producer having answered, so an
 * augment's UI renders on an install without its Uplink. Nothing in `tsc` moves,
 * because a negative test against one arm stays legal however many arms there are.
 *
 * `hasAnswered` is the sanctioned form and the whole point of it is that the NEXT
 * arm gets considered in one place instead of missed in five.
 *
 * Scoped to variables bound from a telemetry read, so it cannot fire on the alarm
 * and objective state machines, which have their own unrelated `"pending"`.
 */
function pendingOnlyGates(sources: ReadonlyMap<string, string>): Suspect[] {
  const found: Suspect[] = [];
  for (const [file, text] of sources) {
    if (/\.test\.tsx?$|\.test-d\.tsx?$/.test(file)) continue;
    if (ALLOWED.has(file)) continue;
    if (!text.includes("useTelemetry(")) continue;
    const lines = text.split("\n");
    const readings = new Set<string>();
    for (const line of lines) {
      const assigned = /const (\w+)\s*=\s*useTelemetry\(/.exec(line);
      if (assigned?.[1] !== undefined) readings.add(assigned[1]);
    }
    if (readings.size === 0) continue;
    for (const [index, line] of lines.entries()) {
      for (const variable of readings) {
        if (
          !new RegExp(`\\b${variable}\\.state\\s*!==\\s*"pending"`).test(line)
        ) {
          continue;
        }
        // Paired with an explicit unowned test on the same line is a considered
        // gate rather than the trap, and stays legal.
        if (line.includes('"unowned"')) continue;
        found.push({ at: `${file}:${index + 1}`, variable });
      }
    }
  }
  return found;
}

const files = trackedSourceFiles();

/**
 * Read once, shared by both guards below.
 *
 * Each of them wants the whole tree, and reading ~2000 files per test lost the 30s
 * limit under `turbo`'s concurrency while passing comfortably on its own. Halving the
 * I/O is the honest fix; raising the timeout would have hidden the duplication.
 */
const sources: ReadonlyMap<string, string> = new Map(
  files.map((f) => [f, readFileSync(join(root, f), "utf8")] as const),
);

describe("styleguide: a Reading is never handed on whole", () => {
  it("passes no raw reading into something that accepts anything", () => {
    const suspects = bareReadings(sources);
    const detail = suspects.map((s) => `  ${s.at}  (${s.variable})`).join("\n");
    expect(
      suspects,
      suspects.length === 0
        ? ""
        : `A telemetry read is passed on whole, without going through a reading ` +
            `accessor or an explicit \`.state\` branch. If the receiver is typed ` +
            `\`unknown\` or takes a cast, it will accept the Reading, fail its own ` +
            `shape checks, and the widget will render as though the vessel reported ` +
            `nothing. That is invisible to \`tsc\`:\n${detail}\n\n` +
            `Narrow it at the read: \`judgeable\` for a verdict, \`stillTrue\` for a ` +
            `standing fact, \`dateable\` for a value you can caption with its age, ` +
            `\`hasAnswered\` for a presence gate.`,
    ).toEqual([]);
  });

  /**
   * Guard on the guard. A scan that matches nothing reports success identically to a
   * scan whose regex has rotted, which is the exact failure this file exists to
   * catch, so it has to prove it can still see.
   */
  it("still recognises the shape it is looking for", () => {
    const probe = [
      "const somethingRaw = useTelemetry('vessel.orbit');",
      "const parsed = parseThing(somethingRaw);",
    ].join("\n");
    const lines = probe.split("\n");
    const assigned = /const (\w+)\s*=\s*useTelemetry\([^)]*\)\s*;\s*$/.exec(
      lines[0] ?? "",
    );
    expect(assigned?.[1]).toBe("somethingRaw");
    expect(/[(,{}[\s]somethingRaw(?![\w.?])/.test(lines[1] ?? "")).toBe(true);
  });

  it("gates presence on hasAnswered, never on pending alone", () => {
    const suspects = pendingOnlyGates(sources);
    const detail = suspects.map((s) => `  ${s.at}  (${s.variable})`).join("\n");
    expect(
      suspects,
      suspects.length === 0
        ? ""
        : `A presence gate tests \`state !== "pending"\`, which reads the ` +
            `\`unowned\` arm as the producer having ANSWERED. Unowned is the ` +
            `strongest evidence there is that no producer exists, so a gate written ` +
            `this way opens on exactly the install where it should close:\n${detail}` +
            `\n\nUse \`hasAnswered(reading)\`, which is false for both empty arms ` +
            `and is the one place the next arm gets considered.`,
    ).toEqual([]);
  });

  /**
   * Guard on the guard, same reasoning as the one above it: a detector that has
   * stopped matching reports zero identically to a clean tree.
   */
  it("still recognises a pending-only gate, and leaves a considered one alone", () => {
    const trap = new Map([
      [
        "widget.tsx",
        [
          'const availability = useTelemetry("weather.available");',
          'const reported = availability.state !== "pending";',
        ].join("\n"),
      ],
    ]);
    expect(pendingOnlyGates(trap)).toEqual([
      { at: "widget.tsx:2", variable: "availability" },
    ]);

    const considered = new Map([
      [
        "widget.tsx",
        [
          'const availability = useTelemetry("weather.available");',
          "const reported =",
          '  availability.state !== "pending" && availability.state !== "unowned";',
        ].join("\n"),
      ],
    ]);
    expect(pendingOnlyGates(considered)).toEqual([]);
  });

  it("scans a non-trivial number of files, so a broken file list cannot pass", () => {
    // The scan is only worth its green if it actually read the tree. A `git
    // ls-files` that returned nothing would satisfy every assertion above.
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.includes("useTelemetry"))).toBe(true);
  });
});

describe("styleguide: useReading is gone", () => {
  /**
   * `useReading` was the transitional hook that returned a `Reading` while
   * `useTelemetry` still returned a payload. Keeping both would have left every
   * widget a choice about whether to confront currency, which is the thing the
   * migration removes, so it was deleted rather than migrated to.
   *
   * Asserted as BOTH "no references" and "no file", because either alone can pass
   * for the wrong reason: a deleted file with a lingering import is a broken build,
   * and a referenced-nowhere file is dead code waiting to be rediscovered.
   */
  it("has no references anywhere in the tree", () => {
    // This file is excluded from its own scan: it names the hook in the doc above
    // and in the needle below, so it would report itself forever. Same reason
    // `styleguide-emdash.test.ts` never spells its character literally. Excluding
    // exactly one path, by name, keeps the doc able to explain what it is guarding.
    const OWN_PATH = "packages/core/src/styleguide-reading-shape.test.ts";
    const referencing = [...sources]
      .filter(([file]) => file !== OWN_PATH)
      .filter(([, text]) => text.includes("useReading"))
      .map(([file]) => file);
    expect(referencing).toEqual([]);
  });

  it("does not exist as a module", () => {
    expect(files).not.toContain("packages/core/src/hooks/useReading.ts");
  });
});
