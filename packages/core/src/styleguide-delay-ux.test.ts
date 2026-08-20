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
 * 2. **`useExecuteAction` stays confined to its sanctioned callers.** It is the
 *    last surviving legacy escape, deliberately kept (not deleted with the
 *    bridge) ONLY for the two widgets whose migration is deferred: `Navball`
 *    (axis/translation, mod-contract-blocked) and `LaunchDirector`'s launch
 *    (T12, which turns launch into a genuinely delayed pad command). No NEW
 *    widget may adopt it, so the set of production files that reference it must
 *    stay a subset of the allowlist below. When Navball or LaunchDirector
 *    finally migrate, drop them from the allowlist (and, once both are gone,
 *    delete `useExecuteAction` outright).
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

// --- Invariant 2: useExecuteAction confined to sanctioned callers ----------

/**
 * Production files allowed to reference `useExecuteAction`. Split into the two
 * sanctioned WIDGET callers (the deferred migrations) and the definition +
 * host-wiring plumbing that necessarily names the hook to expose it. Anything
 * outside this set is a new widget reaching for the legacy escape.
 */
const SANCTIONED_WIDGET_CALLERS = [
  "packages/components/src/Navball/index.tsx",
  "packages/components/src/LaunchDirector/index.tsx",
];

const PLUMBING = [
  // The hook's own (deprecated) definition site. In the sdk since the host
  // implementations moved there: an Uplink's test builds a whole `GonogoHost` and
  // could not reach a definition inside `@ksp-gonogo/core`. Moving the hatch did
  // not widen it, and `packages/core/src/hooks/useExecuteAction.ts` is now a
  // one-line facade over this.
  "mod/sitrep-sdk/src/spine/use-execute-action.ts",
  "packages/core/src/hooks/useExecuteAction.ts",
  // App-side host wiring: forwards the core hook into the sitrep-sdk facade.
  "packages/app/src/uplinks/host.ts",
  // Test-side host wiring, the same forward for an Uplink's own suite. It has
  // no choice: `GonogoHost` is a full interface and the harness builds a whole
  // one, so TypeScript requires this member whether or not a widget calls it.
  // Naming the hook here is not a new caller, it is the same plumbing as the
  // app's builder one line up.
  "mod/sitrep-sdk/src/testing/install-real-test-host.ts",
  // The sitrep-sdk facade: declares the host member + the passthrough shim.
  "mod/sitrep-sdk/src/api/host.ts",
  "mod/sitrep-sdk/src/api/index.ts",
  // A doc-comment reference in the command mapper, not a call site.
  "mod/sitrep-sdk/src/spine/map-command.ts",
];

const ALLOWLIST = new Set([...SANCTIONED_WIDGET_CALLERS, ...PLUMBING]);

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

describe("delay-ux: useExecuteAction stays confined to sanctioned callers", () => {
  // Match the call/definition token `useExecuteAction(`, not the bare word: a
  // migrated widget legitimately keeps a "moved off useExecuteAction" note in
  // its comments, and only the parenthesised form is an actual call, the
  // hook's definition, or the facade's typed passthrough (all plumbing).
  const referencing = productionFilesReferencing("useExecuteAction(");

  it("is referenced only by its allowlisted widgets + plumbing", () => {
    const offenders = referencing.filter((f) => !ALLOWLIST.has(f));
    if (offenders.length > 0) {
      throw new Error(
        `New reference(s) to the deprecated useExecuteAction in ${offenders.length} ` +
          "file(s). Dispatch craft commands through the delay-aware useCommand(topic) " +
          "(from @ksp-gonogo/sitrep-client or the sitrep-sdk facade) so the signal-delay " +
          "UX rides along. useExecuteAction is a closing escape hatch, kept only for the " +
          "deferred Navball + LaunchDirector migrations. Offenders:\n" +
          offenders.map((f) => `  ${f}`).join("\n"),
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it("still names both deferred widget callers (tighten the allowlist when they migrate)", () => {
    for (const caller of SANCTIONED_WIDGET_CALLERS) {
      if (!referencing.includes(caller)) {
        throw new Error(
          `${caller} no longer references useExecuteAction. If it migrated to ` +
            "useCommand, drop it from SANCTIONED_WIDGET_CALLERS in this test (and once " +
            "both deferred callers are gone, delete useExecuteAction outright).",
        );
      }
    }
    expect(referencing).toEqual(
      expect.arrayContaining(SANCTIONED_WIDGET_CALLERS),
    );
  });
});
