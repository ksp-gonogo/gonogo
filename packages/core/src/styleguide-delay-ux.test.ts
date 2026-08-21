import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Delay-UX standard guard (unified-delay-ux plan, Task 8): the backstop that
 * keeps every craft command on the ONE delay-aware dispatch path.
 *
 * Two invariants, both text/structure scans (the `noRestrictedImports` nudge in
 * `biome.json` is the AST-level companion: it flags any
 * `import { useCommand } from "@ksp-gonogo/core"` the moment it is written):
 *
 * 1. **The legacy `useCommand("data")` bridge stays deleted.** It used to live
 *    at `packages/core/src/hooks/useCommand.ts` and re-export from the core
 *    barrel, a non-delay `(action: string) => Promise<void>` dispatcher with no
 *    signal-delay UX. It is gone so that `useCommand` unambiguously means the
 *    delay-aware per-topic hook (`@ksp-gonogo/sitrep-client` / the sitrep-sdk
 *    facade). If the file or its re-export comes back, a command can once again
 *    ship with no delay UX under the SAME name, exactly the ambiguity the plan
 *    removed.
 *
 * 2. **`useExecuteAction` stays deleted.** It was the last legacy escape: a
 *    `(action: string) => Promise<void>` dispatcher that swallowed the
 *    dispatch's rejection outright (`result.then(()=>undefined, ()=>undefined)`),
 *    so a command sent through it could ship with no delay UX AND no way to tell
 *    the operator the game had refused it. Its two remaining callers migrated
 *    (`Navball`'s trim actions and `LaunchDirector`'s launch, both onto
 *    `useCommand`) and the hook went with them, off the sdk barrel and the
 *    `GonogoHost` interface too. Bringing back the name reopens both holes.
 *
 * Uses `git grep` for the same reasons `styleguide-emdash.test.ts` /
 * `uplink-boundary.test.ts` do: it respects `.gitignore` and never has to
 * enumerate files by hand.
 */

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

// --- Invariant 1: the legacy bridge stays deleted -------------------------

const DELETED_BRIDGE = "packages/core/src/hooks/useCommand.ts";
const CORE_BARREL = "packages/core/src/index.ts";

describe('delay-ux: the legacy useCommand("data") bridge stays deleted', () => {
  it("has no packages/core/src/hooks/useCommand.ts file", () => {
    expect(existsSync(join(root, DELETED_BRIDGE))).toBe(false);
  });

  it("is not re-exported from the core barrel", () => {
    const barrel = readFileSync(join(root, CORE_BARREL), "utf8");
    expect(barrel).not.toContain('from "./hooks/useCommand"');
  });
});

// --- Invariant 2: useExecuteAction stays deleted --------------------------

/** The hook's definition sites, both removed when its last two callers migrated. */
const DELETED_HOOK_FILES = [
  "mod/sitrep-sdk/src/spine/use-execute-action.ts",
  "packages/core/src/hooks/useExecuteAction.ts",
];

function isExcludedFromScan(f: string): boolean {
  return (
    f.includes("/dist/") ||
    f.includes("/__generated__/") ||
    f.includes("/test/") ||
    f.includes(".test.") ||
    f.includes(".test-d.") ||
    f.includes(".spec.")
  );
}

function productionFilesReferencing(term: string): string[] {
  let out: string;
  try {
    // `--untracked` is load-bearing: `git grep` alone searches only
    // TRACKED files, so a violation introduced in a BRAND-NEW file is
    // invisible to this scan until the moment it is staged, and a local
    // run before `git add` reports success while not looking at it. It
    // still honours .gitignore, so build output stays out.
    out = execFileSync(
      "git",
      ["grep", "--untracked", "-Il", term, "--", "packages", "mod"],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 64,
      },
    );
  } catch (err) {
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !isExcludedFromScan(f));
}

describe("delay-ux: useExecuteAction stays deleted", () => {
  it("has no definition file left", () => {
    for (const f of DELETED_HOOK_FILES) {
      expect(existsSync(join(root, f))).toBe(false);
    }
  });

  it("is not referenced by any production file", () => {
    // Match the call/definition token `useExecuteAction(`, not the bare word: a
    // migrated widget legitimately keeps a "moved off useExecuteAction" note in
    // its comments, and only the parenthesised form is an actual call, the
    // hook's definition, or a host's typed passthrough.
    const offenders = productionFilesReferencing("useExecuteAction(");
    if (offenders.length > 0) {
      throw new Error(
        `useExecuteAction is back in ${offenders.length} file(s). It was the ` +
          "legacy escape that dispatched with no signal-delay UX and swallowed " +
          "the dispatch's rejection, so a refusal the game issued could never " +
          "reach the operator. Dispatch craft commands through the delay-aware " +
          "useCommand(topic) (from @ksp-gonogo/sitrep-client or the sitrep-sdk " +
          "facade) instead. Offenders:\n" +
          offenders.map((f) => `  ${f}`).join("\n"),
      );
    }
    expect(offenders).toEqual([]);
  });

  it("is not on the sitrep-sdk author-facing barrel", () => {
    const barrel = readFileSync(
      join(root, "mod/sitrep-sdk/src/api/index.ts"),
      "utf8",
    );
    expect(barrel).not.toContain("useExecuteAction");
  });
});

// --- Invariant 3: the arm-then-confirm behaviour has ONE definition ---------

/**
 * The arm window was written out independently in eight widgets, all four
 * seconds, none of them sharing a line. That is one behaviour spelled eight
 * times, so it could drift eight ways, and it did drift in an adjacent
 * dimension: five of those widgets grew a pending state and the other three
 * did not, on no rule at all. `Strategies` also grew a reconciliation effect
 * that cleared its pending state unconditionally, without ever reading the
 * field it claimed to be waiting on, so "Activating..." lasted a single frame
 * and read to the operator as the command having landed.
 *
 * `@ksp-gonogo/ui-kit`'s `CommandButton` / `useCommandButton` owns arm,
 * confirm, in-flight and refused now. ui-kit rather than ui because it is the
 * published package, so an Uplink can reach it: `ScienceFileManager`'s local
 * copy was one a third party could not have shared.
 *
 * A widget that needs its own CHROME is expected and fine, and several have one
 * (a measured collapsing label, a colour per verb). Those take the hook. What
 * must not come back is a second copy of the STATE MACHINE.
 */
const ARM_TIMEOUT_OWNER = "packages/ui-kit/src/CommandButton/CommandButton.tsx";

describe("delay-ux: arm-then-confirm has one definition", () => {
  it("declares the arm window in ui-kit's CommandButton and nowhere else", () => {
    // The DECLARATION, not the identifier: a caller importing `ARM_TIMEOUT_MS`
    // from ui-kit to assert against is reading the one definition, which is the
    // point, and must not be flagged.
    const offenders = productionFilesReferencing("const ARM_TIMEOUT_MS").filter(
      (f) => f !== ARM_TIMEOUT_OWNER,
    );
    if (offenders.length > 0) {
      throw new Error(
        `${offenders.length} file(s) declare their own arm window. Arm, ` +
          "confirm, in-flight and refused are one state machine and it lives " +
          `in ${ARM_TIMEOUT_OWNER}. Render <CommandButton> for the standard ` +
          "control, or call useCommandButton() when the chrome genuinely " +
          "differs. Offenders:\n" +
          offenders.map((f) => `  ${f}`).join("\n"),
      );
    }
    expect(offenders).toEqual([]);
  });

  it("still has an owner, so the scan above cannot pass by having nothing to find", () => {
    // Without this, deleting the primitive turns the check above green: an
    // empty offender list reads identically whether the rule is being upheld or
    // the thing it protects is gone.
    expect(existsSync(join(root, ARM_TIMEOUT_OWNER))).toBe(true);
    expect(readFileSync(join(root, ARM_TIMEOUT_OWNER), "utf8")).toContain(
      "const ARM_TIMEOUT_MS",
    );
  });
});
