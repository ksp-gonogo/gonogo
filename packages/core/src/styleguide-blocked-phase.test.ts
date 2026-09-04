// @vitest-environment node
//
// esbuild's `transformSync`, used to strip comments below, asserts
// `new TextEncoder().encode("") instanceof Uint8Array` and throws "JavaScript
// environment is broken" under jsdom, where that realm does not line up.
// Nothing in this file touches the DOM. Same reason as `uplink-boundary`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { styleguideScanRoots } from "./styleguideScanRoots";

/**
 * A hand-rolled command control must render the BLOCKED phase.
 *
 * `useCommandButton` returns `isBlocked` and `refusalText`: the game's standing
 * verdict on a command, issued before anybody presses anything. A caller that
 * destructures neither has thrown that verdict away, and the control it draws
 * then answers the affordability question out of whatever it happened to have
 * locally.
 *
 * ## The defect this exists to prevent
 *
 * `SpaceCenterStatus` hosts RP-1's facility-upgrade control and drew its own
 * stock funds verdict on the stock `career.facility.upgrade` button. Under RP-1
 * that command is blocked outright on every managed save, and the widget never
 * read the gate. One screen showed:
 *
 *   - Launch Pad `112.5k` and R&D `60.0k` in RED with dark Upgrade buttons, a
 *     shortfall verdict on a purchase nobody is charged for
 *   - VAB `40.0k` in GREEN with a LIVE Upgrade button, for a press RP-1 refuses
 *   - and 300px below, the correct sentence: "RP-1 bills a construction as it
 *     builds, so a short career slows the work rather than stopping it",
 *     offering Queue upgrade on the same tiers
 *
 * Neither half of that was in the RP-1 Uplink. All three RP-1 controls were
 * compliant; the wrong claim was in the CORE widget the Uplink contributes
 * into. That is structural to the augment model rather than one unlucky file:
 * an Uplink's spend control lands inside a host that already carries one, and
 * the host's claim was written for the stock economy. Nothing checked the host,
 * so this does.
 *
 * ## The rule
 *
 * A file that reaches `useCommandButton` must reference `isBlocked`.
 *
 * The remedy for a file that cannot is `CommandButton`, the shared control,
 * which renders the blocked phase (dark, `aria-disabled`, the gate's own
 * sentence as its accessible name) and lets `refusalText` win the title. Most
 * callers should be using it: the hook exists for chrome that genuinely differs
 * (`SpaceCenterStatus` measures its label and collapses it to an icon,
 * `LaunchDirector` colours by verb), and taking it means taking every phase
 * with it.
 *
 * ## What this does NOT cover
 *
 * "A widget calling a spend free must have read every currency it could be
 * priced in", the `Strategies` half of the same audit, where "No setup cost"
 * sat over a live Activate for a Program costing 300 Confidence. That is not
 * statically checkable and no proxy for it is invented here. It is held by
 * `packages/components/src/Strategies/spend-truth.test.tsx`.
 */

/** The hook whose blocked phase is the subject. */
const HOOK = "useCommandButton";

/** The field on its return that says the game has already answered. */
const BLOCKED_PHASE = "isBlocked";

/**
 * The hook's own definition site, which is also its first consumer: the shared
 * `CommandButton` is this hook plus the default rendering. It anchors the
 * caller floor below, because it cannot stop being a caller while the hook
 * exists.
 */
const SHARED_BUTTON = "packages/ui-kit/src/CommandButton/CommandButton.tsx";

/**
 * Files that reach the hook and do not render its blocked phase, seeded
 * 2026-09-04 at the census. Shrink-only: an entry whose file has since taken
 * the phase is a failure, not a record, because the entry then stands as a
 * live excuse for the next widget to drop it again.
 *
 * The value is the reason, not a count, because there is nothing to count: a
 * control either renders the phase or does not.
 */
const BLOCKED_PHASE_DEBT: Record<string, string> = {
  // Its two hand-rolled controls are a scene switch and the pad/flight verbs
  // (launch, recover, revert), so no spend-truth claim rides on either and
  // there is no price beside them to be wrong about. Left alone deliberately
  // rather than overlooked. What would remove this entry: giving `ArmedButton`
  // and the Tracking Station control the blocked phase, which is worth doing on
  // its own merits (a revert the game will refuse currently looks pressable)
  // and is a UX decision about warning-worded chrome, not a mechanical edit.
  "packages/components/src/LaunchDirector/index.tsx":
    "Scene switch and pad verbs, no price beside the control. Wants the phase anyway; the chrome question is unanswered.",
  // THE DEFECT ABOVE, at this branch's base. It is already fixed on
  // `origin/fleet/spendtruth` (`cae745688`), which is not yet in `staging`: that
  // commit destructures `isBlocked`, suppresses the funds verdict where the gate
  // blocks, and gives `UpgradeButton` the phase it was missing.
  //
  // Expect this line to go STALE the moment that lands and to be deleted in the
  // same commit, which is the ratchet working rather than a chore. It is here
  // only because a debt list must describe the tree it grades, and on this base
  // the widget is still discarding the verdict.
  "packages/components/src/SpaceCenterStatus/index.tsx":
    "The facility-upgrade defect. Fixed on origin/fleet/spendtruth (cae745688); delete this entry when that lands.",
};

/**
 * Not source under this rule:
 *  - tests and type-tests, which own the controls they render and assert the
 *    phase rather than draw it
 *  - `__fixtures__` and `__generated__`, neither hand-written
 *  - `/dist/`, build output (untracked, so belt and braces)
 */
const EXCLUDED = /\/dist\/|\.test\.|\.spec\.|test-d|__fixtures__|__generated__/;

/**
 * Scan floors. Both are held well under the live numbers so ordinary movement
 * never trips them and only a broken walk does.
 *
 * `styleguide-wall-clock` is why the ROOT floor exists: it walked 1 widget root
 * of 13 and stayed green for months, because its only guard against a broken
 * scan was a stale-entry check, which protects against a walk reading NOTHING
 * and not against one reading a thirteenth of the tree. A per-root assertion is
 * the shape that catches it: 19 roots at the time of writing, none empty.
 */
const MINIMUM_ROOTS = 15;
const MINIMUM_FILES = 800;

const HERE = dirname(fileURLToPath(import.meta.url));

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: HERE,
    encoding: "utf8",
  }).trim();
}

/**
 * Comments removed, strings kept, through the same parser `uplink-boundary`
 * uses and for the same reason: a character-state machine cannot tell an
 * apostrophe in JSX text (`don't`) from an opening quote, desynchronises, and
 * then either preserves comments it should have dropped or blanks the code
 * after them. A gate that silently stops looking.
 *
 * Stripping matters in BOTH directions here, which is why it is not skipped:
 * a file that merely documents the hook in prose is not a caller, and a caller
 * that writes `// we ignore isBlocked here` has not rendered the phase. The
 * second is the dangerous one, because it satisfies the gate by writing about
 * the thing it is not doing.
 *
 * Throws rather than falling back. A file this cannot parse is a file not
 * scanned, and swallowing that is precisely the failure mode this family of
 * guards exists to make visible; the caller collects the throw and fails.
 */
function stripComments(source: string, path: string): string {
  const js = transformSync(source, {
    loader: path.endsWith(".tsx") ? "tsx" : "ts",
    format: "esm",
    // Without this esbuild ELIDES an import whose binding is unused, and an
    // elided import is an invisible one.
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  }).code;
  // esbuild makes no promise about dropping every comment. Finish with a
  // LINE-BASED pass, which cannot desynchronise; its error direction is right,
  // because a trailing `// ...` after code survives, so the worst case is a
  // file flagged rather than one silently skipped.
  return js
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

/**
 * `export { ... } from "..."`, matched on the RAW source.
 *
 * Order matters and cost a debugging round: esbuild NORMALISES a re-export into
 * an `import { X } from "..."` plus a bare `export { X }`, so after stripping
 * there is no `from` clause left to recognise and the barrel came back a caller.
 * Both readers below therefore run against the raw text, before the parser
 * rewrites the shape they are looking for.
 */
const RE_EXPORT = /export\s*\{[^}]*\}\s*from\s*["'][^"']+["']\s*;?/g;

/**
 * The source with its re-export statements removed.
 *
 * A barrel that re-exports the hook is not a caller of it, and
 * `packages/ui-kit/src/index.ts` is exactly that. Removing the statement rather
 * than exempting the file by path means a future barrel is handled the day it
 * lands, and means a barrel that ALSO calls the hook is still caught.
 */
function withoutReExports(raw: string): string {
  return raw.replace(RE_EXPORT, "");
}

/**
 * Every spelling of reaching the hook, by looking for its IDENTIFIER rather
 * than for a call shape.
 *
 * `uplink-isolation` is the cautionary tale: it required the token `from` and
 * was blind to `import "x"`, `import("x")` and `require("x")`, with the gap
 * documented twenty lines below the pattern. A call-shape regex here has the
 * same problem in more directions, because the hook can be reached as:
 *
 *   useCommandButton({ ... })                          plain
 *   useCommandButton<Result>({ ... })                  with a type argument
 *   useCommandButton\n  ({ ... })                      newline before the paren
 *   kit.useCommandButton({ ... })                      namespace member access
 *   import { useCommandButton as useCmdBtn }           renamed on import
 *   const { useCommandButton } = require("...")        CJS destructure
 *   const { useCommandButton } = await import("...")   dynamic destructure
 *
 * The identifier is present in all seven, because even the renamed forms must
 * name it on the import to rename it. That leaves exactly one hole, re-export
 * laundering (`export { useCommandButton as X } from "..."`, after which a
 * downstream file never types the identifier), and `launderedAliases` below
 * closes it by asserting no such re-export exists.
 */
function isCaller(strippedNoReExports: string): boolean {
  return new RegExp(String.raw`\b${HOOK}\b`).test(strippedNoReExports);
}

/** Whether a caller reads the standing verdict at all. */
function handlesBlockedPhase(strippedNoReExports: string): boolean {
  return new RegExp(String.raw`\b${BLOCKED_PHASE}\b`).test(strippedNoReExports);
}

/**
 * The verdict on one file, as the walk computes it. Exists so the planted
 * checks drive the PRODUCTION path rather than a re-spelling of it: three
 * transformations in a fixed order, and it was the order that was wrong the
 * first time (see RE_EXPORT).
 */
function verdict(
  raw: string,
  path: string,
): { caller: boolean; phase: boolean } {
  const stripped = stripComments(withoutReExports(raw), path);
  return {
    caller: isCaller(stripped),
    phase: handlesBlockedPhase(stripped),
  };
}

/**
 * Names the hook is re-exported UNDER, other than its own.
 *
 * The one spelling `isCaller` cannot see. A downstream file importing the alias
 * never types `useCommandButton`, so it would be walked past entirely: not
 * flagged, not listed, invisible. Held at zero rather than resolved, because
 * resolving it means following re-export chains and a repo with no aliases in
 * it does not need that machinery.
 */
function launderedAliases(raw: string): string[] {
  const out: string[] = [];
  for (const statement of raw.match(RE_EXPORT) ?? []) {
    for (const [, alias] of statement.matchAll(
      new RegExp(String.raw`\b${HOOK}\s+as\s+(\w+)`, "g"),
    )) {
      out.push(alias);
    }
  }
  return out;
}

/**
 * Entries whose file now renders the phase, formatted for the failure. A pure
 * function of its two inputs so the planted check can drive it with a synthetic
 * pair whose answer is known: this arm exists to make a stale entry visible, so
 * it failing silently would restore the defect it was added to prevent.
 */
function staleEntries(
  debt: Record<string, string>,
  offenders: Set<string>,
): string[] {
  return Object.keys(debt)
    .filter((file) => !offenders.has(file))
    .sort()
    .map((file) => `  ${file}`);
}

interface Walk {
  /** Roots walked, and how many source files each yielded. */
  perRoot: Map<string, number>;
  /** Source files read. */
  filesWalked: number;
  /** Files reaching the hook, by any spelling. */
  callers: string[];
  /** Callers that never reference `isBlocked`. */
  offenders: Set<string>;
  /** Aliases the hook is re-exported under. */
  aliases: { file: string; alias: string }[];
  /** Files esbuild could not parse, which are therefore files not scanned. */
  unparseable: string[];
}

function walk(root: string): Walk {
  const perRoot = new Map<string, number>();
  const callers: string[] = [];
  const offenders = new Set<string>();
  const aliases: { file: string; alias: string }[] = [];
  const unparseable: string[] = [];
  let filesWalked = 0;

  for (const rel of styleguideScanRoots(root)) {
    const listed = execFileSync("git", ["ls-files", rel], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !EXCLUDED.test(f));
    perRoot.set(rel, listed.length);

    for (const file of listed) {
      filesWalked++;
      const source = readFileSync(join(root, file), "utf8");
      // Cheap pre-filter on the RAW source. Stripping only removes text, so a
      // file with no occurrence of the identifier before stripping cannot gain
      // one after: the raw hit set is a superset of the real one by
      // construction, and parsing the other ~960 files buys nothing but 40s.
      if (!source.includes(HOOK)) continue;
      for (const alias of launderedAliases(source)) {
        aliases.push({ file, alias });
      }
      let seen: { caller: boolean; phase: boolean };
      try {
        seen = verdict(source, file);
      } catch {
        unparseable.push(file);
        continue;
      }
      if (!seen.caller) continue;
      callers.push(file);
      if (!seen.phase) offenders.add(file);
    }
  }
  return { perRoot, filesWalked, callers, offenders, aliases, unparseable };
}

const root = repoRoot();
const scan = walk(root);

describe("a hand-rolled command control renders the blocked phase", () => {
  it("walked every scan root, and none of them empty", () => {
    /*
     * The wall-clock failure, asked directly. A root that yields no files is
     * indistinguishable from a rule with no subjects, and the difference is
     * whether the guard is guarding.
     */
    const empty = [...scan.perRoot]
      .filter(([, n]) => n === 0)
      .map(([rel]) => rel);
    expect(empty, "scan roots that yielded no source file").toEqual([]);
    expect(scan.perRoot.size).toBeGreaterThanOrEqual(MINIMUM_ROOTS);
    /*
     * Both halves named rather than inferred from a total. This rule is about
     * HOST widgets and Uplink widgets alike, and a walk that lost one side
     * entirely would still clear a file floor on the other.
     */
    expect(
      [...scan.perRoot.keys()].some((r) => r.startsWith("packages/")),
    ).toBe(true);
    expect([...scan.perRoot.keys()].some((r) => r.startsWith("mod/"))).toBe(
      true,
    );
  });

  it("read the source files under them", () => {
    expect(scan.filesWalked).toBeGreaterThanOrEqual(MINIMUM_FILES);
  });

  it("could parse every file it needed to strip", () => {
    /*
     * A parse failure is a file skipped, and a skipped file is a silent pass.
     * Reported rather than swallowed, which is the whole difference between
     * this and the `catch` that would have made it go away.
     */
    expect(scan.unparseable, "files esbuild could not parse").toEqual([]);
  });

  it("still finds the hook's own consumer", () => {
    /*
     * The caller floor, anchored on ONE path rather than a count. A count is a
     * tripwire here: the fix this gate asks for is usually to move to the
     * shared `CommandButton`, which REMOVES a caller, so a floor of three would
     * fail for the tree improving. `CommandButton` itself cannot stop calling
     * the hook while the hook exists, and if the hook goes away this whole file
     * should go with it.
     */
    expect(scan.callers).toContain(SHARED_BUTTON);
  });

  it("can see a violation (planted)", () => {
    /*
     * A scan whose pattern stops matching reports a clean repo, and a clean
     * repo reads as success. Every spelling the header lists is planted here,
     * with `isBlocked` absent, and every one must come back a caller.
     */
    const spellings: Record<string, string> = {
      plain: `const s = ${HOOK}({ handle });`,
      typeArgument: `const s = ${HOOK}<Result>({ handle });`,
      newlineBeforeParen: `const s = ${HOOK}\n  ({ handle });`,
      namespaceMember: `import * as kit from "@ksp-gonogo/ui-kit";\nconst s = kit.${HOOK}({ handle });`,
      renamedOnImport: `import { ${HOOK} as useCmdBtn } from "@ksp-gonogo/ui-kit";\nconst s = useCmdBtn({ handle });`,
      requireDestructure: `const { ${HOOK} } = require("@ksp-gonogo/ui-kit");`,
      dynamicImportDestructure: `const { ${HOOK} } = await import("@ksp-gonogo/ui-kit");`,
    };
    const missed = Object.entries(spellings)
      .filter(([name, src]) => !verdict(src, `${name}.ts`).caller)
      .map(([name]) => name);
    expect(
      missed,
      "spellings of reaching the hook this scan walks past",
    ).toEqual([]);

    // And the second half of the rule: a caller with no `isBlocked` is an
    // offender. Asserted separately because a matcher that finds every caller
    // and then grades none of them is the same silent pass.
    const graded = Object.entries(spellings)
      .filter(([name, src]) => verdict(src, `${name}.ts`).phase)
      .map(([name]) => name);
    expect(
      graded,
      "spellings scored as handling a phase they never read",
    ).toEqual([]);
  });

  it("does not flag what it should not (planted)", () => {
    /*
     * The false-positive half. A gate that flags legitimate code gets an
     * exemption bolted on to quieten it, and the exemption is what the next
     * real violation hides behind.
     */
    const consumerOfSharedButton = [
      `import { CommandButton } from "@ksp-gonogo/ui-kit";`,
      `export const Widget = () => <CommandButton handle={h} label="Go" />;`,
    ].join("\n");
    expect(verdict(consumerOfSharedButton, "w.tsx").caller).toBe(false);

    // A file that merely writes ABOUT the hook. Comment stripping is the only
    // thing standing between this and a false positive, and the pre-filter in
    // `walk` deliberately lets it through to here.
    const prose = [
      `// Behaviour is the shared ${HOOK}; the chrome stays local.`,
      `/** See ${HOOK} for the phases. */`,
      `export const Widget = () => null;`,
    ].join("\n");
    expect(verdict(prose, "w.tsx").caller).toBe(false);

    // A barrel re-exporting the hook under its own name is not a caller.
    const barrel = `export {\n  CommandButton,\n  ${HOOK},\n} from "./CommandButton/CommandButton";`;
    expect(verdict(barrel, "index.ts").caller).toBe(false);

    // And a caller that DOES render the phase passes, which is the state the
    // whole gate is asking for.
    const compliant = `const { isBlocked, refusalText, press } = ${HOOK}({ handle });`;
    expect(verdict(compliant, "w.ts")).toEqual({ caller: true, phase: true });

    // A caller whose only `isBlocked` is in a comment has NOT rendered the
    // phase. The dangerous direction: it satisfies a naive grep by writing
    // about the thing it is not doing.
    const commentedAway = [
      `// isBlocked is deliberately ignored here.`,
      `const { press } = ${HOOK}({ handle });`,
    ].join("\n");
    expect(verdict(commentedAway, "w.ts")).toEqual({
      caller: true,
      phase: false,
    });
  });

  it("can see a stale entry (planted)", () => {
    /*
     * The shrink arm's guard-on-the-guard. The planted check above proves the
     * matcher still matches; it says nothing about the comparison that turns a
     * compliant file into a stale-entry failure, and a comparison that stopped
     * comparing would report a tight list forever.
     */
    expect(
      staleEntries(
        { answered: "was", still: "is" },
        new Set(["still", "unlisted"]),
      ),
    ).toEqual(["  answered"]);
    expect(staleEntries({ still: "is" }, new Set(["still"]))).toEqual([]);
  });

  it("has no entry for a path that no longer exists", () => {
    /*
     * An entry for a deleted file can never be spent, so it never trips the
     * arm below and no run ever mentions it. The magnitude budget was found
     * carrying one of these for a widget directory deleted outright.
     */
    const missing = Object.keys(BLOCKED_PHASE_DEBT)
      .filter((rel) => !existsSync(join(root, rel)))
      .sort();
    expect(missing, "listed paths that no longer exist, delete them").toEqual(
      [],
    );
  });

  it("re-exports the hook under no other name", () => {
    /*
     * The one hole in identifier matching, held shut rather than papered over:
     * a downstream file importing an alias never types `useCommandButton` and
     * would be walked past entirely. If this ever needs to be allowed, follow
     * the alias in `isCaller`; do not delete the check.
     */
    // The check itself, proven able to fire, because the tree has no subject
    // for it and a check with no subject is one nobody has seen work.
    expect(
      launderedAliases(`export { ${HOOK} as useCmdBtn } from "./x";`),
    ).toEqual(["useCmdBtn"]);
    expect(launderedAliases(`export { ${HOOK} } from "./x";`)).toEqual([]);

    expect(scan.aliases, "the hook re-exported under an alias").toEqual([]);
  });

  it("has no listed file that now renders the phase", () => {
    const stale = staleEntries(BLOCKED_PHASE_DEBT, scan.offenders);
    if (stale.length > 0) {
      throw new Error(
        "These files now render the blocked phase and are still listed as not " +
          "doing so. An entry left behind is a standing excuse for the next " +
          "control to drop the phase again. Delete each one from " +
          "BLOCKED_PHASE_DEBT in " +
          "packages/core/src/styleguide-blocked-phase.test.ts, in the same " +
          "commit as the fix:\n" +
          stale.join("\n"),
      );
    }
    expect(stale).toEqual([]);
  });

  it("has no unlisted caller dropping the blocked phase", () => {
    const unlisted = [...scan.offenders]
      .filter((file) => !(file in BLOCKED_PHASE_DEBT))
      .sort()
      .map((file) => `  ${file}`);
    if (unlisted.length > 0) {
      throw new Error(
        `These files call ${HOOK} and never reference ${BLOCKED_PHASE}, so the ` +
          "game's standing verdict on the command reaches the control and is " +
          "discarded. The control then answers the affordability question out " +
          "of whatever it has locally, which is how a widget came to paint a " +
          "shortfall on a purchase nobody is charged for and a live button on " +
          "a press the game refuses.\n\n" +
          "Either render the phase (dark, `aria-disabled` not `disabled`, " +
          "`refusalText` as the accessible name) or move the control to the " +
          "shared `CommandButton`, which does all of that:\n" +
          unlisted.join("\n"),
      );
    }
    expect(unlisted).toEqual([]);
  });
});
