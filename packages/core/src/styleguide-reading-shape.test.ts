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
 * The accessors are the sanctioned narrowings (`observedValue`, `stillTrue`,
 * `dateable`, `withoutReckoning`, `readingAge`, `notCurrent`, `hasAnswered`,
 * `readingOf`), plus an explicit branch on either discriminant, `.state` or
 * `.reckoning`, which is what a widget with its own rule writes.
 *
 * `readingOf` joined the list when the scan was widened to see the bound hook, and it
 * is a narrowing of a different kind from the rest: it maps the value INSIDE a
 * reading and hands back a reading, so the currency information travels with it
 * instead of being discarded at the call. That is exactly what the receivers this
 * scan protects need, and a site using it was never at risk.
 *
 * `observedValue` and `hasAnswered` are the two exported from the SDK; the rest are
 * per-site local helpers matched by name. Both were shared for the same reason, which
 * is the reason this list should be read as a live judgement rather than a fixed set:
 * a narrowing written out by hand at many sites is a MISSING EXPORT, and it stays
 * copied for as long as the SDK withholds it. `hasAnswered` answers the presence-gate
 * question ("has the producer spoken at all") that five sites were answering by hand
 * as `state !== "pending"`, each reading the `unowned` arm as the producer having
 * answered. `observedValue` answers "the value, only while it is current", and stood
 * copy-pasted in thirty-nine identical definitions before it was exported.
 */
const ACCESSORS =
  /observedValue|stillTrue|dateable|withoutReckoning|readingAge|notCurrent|hasAnswered|readingOf/;

/**
 * A telemetry read bound to a variable, in EITHER of the two spellings the tree uses.
 *
 * The optional `<identifier>.` prefix is the whole point. A widget in the built-in
 * library declares its topics through `defineTopicManifest` and reads through the
 * bound hook it yields, `const x = topics.useTelemetry("vessel.orbit")`, and that is
 * the form CLAUDE.md prescribes precisely because declaration and read cannot drift
 * apart. Matching only the free function made this scan blind to the recommended
 * shape: 30 of the 115 reads in the tree, and a share that GREW every time a widget
 * adopted the house style. A gate whose coverage shrinks as the codebase improves is
 * worse than no gate, because its green is read as evidence.
 *
 * Deliberately not anchored to a specific receiver name. `topics` is the convention
 * and not a rule, and a scan that hard-coded it would go blind again the first time
 * someone named the manifest something else.
 */
const READ_ASSIGNMENT =
  /const (\w+)\s*=\s*(?:\w+\.)?useTelemetry\([^)]*\)\s*;\s*$/;

/** The same two spellings, unanchored, for collecting every variable bound to a read. */
const READ_BINDING = /const (\w+)\s*=\s*(?:\w+\.)?useTelemetry\(/;

/**
 * The two sanctioned exceptions, with their reasons.
 *
 * The probe render harness feeds widgets from recorded fixtures and reads
 * `<domain>.available` generically, by template-built topic id, for whatever domain a
 * fixture happens to carry. It is a dev-only harness, it is currently broken on
 * `staging` for an unrelated reason, and it is the one place where the read is
 * genuinely untyped by construction. Listed rather than silently skipped so that
 * "the harness is exempt" stays a decision someone made.
 *
 * The second is the primitive-reading-feed gate's planted violation. It holds a
 * bare read on purpose, because that gate's whole subject is what happens to a
 * reading between the read and the prop: narrowing it at the read, which is
 * what this rule would otherwise ask for, deletes the thing being measured.
 * The file is in no tsconfig, is compiled only by that gate's own test, and
 * ships nowhere.
 */
const ALLOWED = new Set([
  "packages/components/scripts/probe/probe-entry.tsx",
  "packages/components/fixtures/primitive-reading-feed-plant.tsx",
]);

/**
 * Names of functions declared in this file that take a reading. Calling one is a
 * narrowing, because the parameter type is the thing that makes it safe.
 *
 * `Reading` is one of three spellings, not the only one: a topic the contract
 * declares reckonable answers with `ReckonableReading`, and one in
 * `NEVER_RECKONABLE` with `UnmodelledReading`. All three are unions a caller has
 * to branch, so a helper typed for any of them narrows, and matching only the
 * bare name reported two correctly-narrowed widgets as bare reads.
 */
function localNarrowers(text: string): string[] {
  const names: string[] = [];
  const decl =
    /(?:function\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*:\s*\w*Reading<|const\s+(\w+)\s*=\s*(?:<[^>]*>)?\s*\([^)]*:\s*\w*Reading<)/g;
  let m: RegExpExecArray | null = decl.exec(text);
  while (m !== null) {
    const name = m[1] ?? m[2];
    if (name !== undefined) names.push(name);
    m = decl.exec(text);
  }
  return names;
}

/**
 * The same narrowing, IMPORTED rather than declared beside its callers.
 *
 * A widget with its own rule writes a helper; several widgets sharing one rule
 * import it, and the parameter type is what makes either safe. Reading only the
 * calling file said otherwise: `GonogoRp1Uplink`'s `current(reading)` is typed
 * `TopicReading<T>`, is used 77 times across 22 widgets, and was refused here
 * purely for living in `shared/current.ts`. The alternative on offer was 22
 * copies of one helper, which is the thing a gate exists to prevent.
 *
 * <b>Resolved to a DECLARATION, never matched by name.</b> A name list would
 * bless every future `current` regardless of what it takes, which is the hole
 * this is supposed to close rather than widen: the import is followed to its
 * file, and the helper counts only if that file declares it taking a reading.
 * The negative plant below is what holds that line.
 */
function importedNarrowers(
  file: string,
  text: string,
  sources: ReadonlyMap<string, string>,
): string[] {
  const names: string[] = [];
  const imports =
    /import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']*)["']|import\s*\{([^}]*)\}\s*from\s*["']([^."'][^"']*)["']/g;
  let m: RegExpExecArray | null = imports.exec(text);
  while (m !== null) {
    const bindings = (m[1] ?? m[3] ?? "")
      .split(",")
      .map((b) =>
        b
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim(),
      )
      .filter((b): b is string => b !== undefined && b.length > 0);
    const from = m[2];
    if (from !== undefined) {
      for (const candidate of resolveRelative(file, from)) {
        const imported = sources.get(candidate);
        if (imported === undefined) continue;
        const declared = new Set(localNarrowers(imported));
        for (const binding of bindings) {
          if (declared.has(binding)) names.push(binding);
        }
        break;
      }
    }
    m = imports.exec(text);
  }
  return names;
}

/**
 * The files a relative specifier could mean, in the order a bundler would try
 * them. Extensionless because the tree is written that way, and `index` last
 * because a directory import is the rarer spelling here.
 */
function resolveRelative(from: string, specifier: string): string[] {
  const base = join(dirname(from), specifier).replace(/\\/g, "/");
  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    base,
  ];
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
      const assigned = READ_ASSIGNMENT.exec(line);
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
      // accessor, and the receiver being typed `TopicReading<T>` is exactly what makes it
      // safe: the hazard this scan exists for is a receiver that accepts anything.
      // An IMPORTED one counts for the same reason, resolved to its declaration
      // rather than trusted by name: see `importedNarrowers`.
      const narrowers = [
        ...localNarrowers(text),
        ...importedNarrowers(file, text, sources),
      ];
      if (
        narrowers.some((fn) =>
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
      const assigned = READ_BINDING.exec(line);
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
            `Narrow it at the read: \`observedValue\` for a value that only ` +
            `counts while it is current, \`stillTrue\` for a ` +
            `standing fact, \`dateable\` for a value you can caption with its age, ` +
            `\`hasAnswered\` for a presence gate.`,
    ).toEqual([]);
  });

  /**
   * Guard on the guard. A scan that matches nothing reports success identically to a
   * scan whose regex has rotted, which is the exact failure this file exists to
   * catch, so it has to prove it can still see.
   */
  it("counts a helper typed for any reading, and nothing typed unknown", () => {
    const helpers = [
      "function describe<T>(r: TopicReading<T>): T | undefined { return undefined; }",
      "const project = <T, K extends keyof T>(r: ReckonableReading<T, K>) => r;",
      "function plain<T>(r: UnmodelledReading<T>): T | undefined { return undefined; }",
      "function parseThing(raw: unknown): string | undefined { return undefined; }",
    ].join("\n");

    // All three reading spellings, and NOT the `unknown` receiver, which is the
    // hazard the scan exists for. A regex that widened far enough to accept the
    // fourth would report every tree clean.
    expect(localNarrowers(helpers).sort()).toEqual([
      "describe",
      "plain",
      "project",
    ]);
  });

  /**
   * Guard on the guard, driven through `bareReadings` itself rather than through a
   * copy of its regex.
   *
   * The previous version of this test pasted the assignment pattern inline and
   * asserted the copy still matched, which is how the blindness it now covers went
   * unnoticed: the copy and the scan agreed with each other perfectly while both
   * missed the bound hook. Calling the real function is the only form of this test
   * that can fail for the right reason.
   *
   * Both spellings appear, and so do both narrowings, because a pattern widened far
   * enough to see the bound read is also wide enough to start swallowing the reads
   * that were never at risk.
   */
  it("sees a bare read in BOTH spellings, and leaves a narrowed one alone", () => {
    const bare = new Map([
      [
        "free.tsx",
        [
          'const freeRaw = useTelemetry("science.instruments");',
          "const parsed = parseThing(freeRaw);",
        ].join("\n"),
      ],
      [
        "bound.tsx",
        [
          'const boundRaw = topics.useTelemetry("science.instruments");',
          "const parsed = parseThing(boundRaw);",
        ].join("\n"),
      ],
      [
        "renamed.tsx",
        [
          'const viaOtherName = manifest.useTelemetry("science.instruments");',
          "const parsed = parseThing(viaOtherName);",
        ].join("\n"),
      ],
    ]);
    expect(bareReadings(bare)).toEqual([
      { at: "free.tsx:1", variable: "freeRaw" },
      { at: "bound.tsx:1", variable: "boundRaw" },
      { at: "renamed.tsx:1", variable: "viaOtherName" },
    ]);

    const narrowed = new Map([
      [
        "declined.tsx",
        [
          'const orbit = topics.useTelemetry("vessel.orbit");',
          "const parsed = parseThing(withoutReckoning(orbit));",
        ].join("\n"),
      ],
      [
        "mapped.tsx",
        [
          'const orbit = topics.useTelemetry("vessel.orbit");',
          "const parsed = parseThing(readingOf(orbit, (o) => o.sma));",
        ].join("\n"),
      ],
    ]);
    expect(bareReadings(narrowed)).toEqual([]);
  });

  /**
   * The widening for a SHARED narrower, with the plant that stops it becoming a
   * blanket pass.
   *
   * Three files, one scan. The first imports a helper whose own file declares it
   * taking a reading, and is clean. The second imports a helper of the same NAME
   * from a file that declares it taking `unknown`, and must still be reported:
   * that is the hazard, and a gate that trusted the name would wave it through.
   * The third hands the read to a helper the tree never declares at all.
   *
   * Written as three at once because a gate wide enough to see the first is wide
   * enough to start swallowing the other two, which is the failure this file
   * exists to catch rather than to demonstrate.
   */
  it("accepts an imported narrower, and still refuses one that only shares its name", () => {
    const tree = new Map([
      [
        "widget/shared/current.ts",
        "export function current<T>(r: TopicReading<T>): T | undefined { return undefined; }",
      ],
      [
        "widget/good.tsx",
        [
          'import { current } from "./shared/current";',
          'const slots = topics.useTelemetry("rp1.programSlots");',
          "const plain = current(slots);",
        ].join("\n"),
      ],
      [
        "other/shared/current.ts",
        "export function current(raw: unknown): number | undefined { return undefined; }",
      ],
      [
        "other/impostor.tsx",
        [
          'import { current } from "./shared/current";',
          'const slots = topics.useTelemetry("rp1.programSlots");',
          "const plain = current(slots);",
        ].join("\n"),
      ],
      [
        "nowhere/unresolved.tsx",
        [
          'import { current } from "./shared/current";',
          'const slots = topics.useTelemetry("rp1.programSlots");',
          "const plain = current(slots);",
        ].join("\n"),
      ],
    ]);

    expect(bareReadings(tree)).toEqual([
      { at: "other/impostor.tsx:2", variable: "slots" },
      { at: "nowhere/unresolved.tsx:2", variable: "slots" },
    ]);
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
