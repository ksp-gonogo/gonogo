import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { styleguideScanRoots } from "./styleguideScanRoots";

/**
 * Lock scopes have one implementation: ui-kit's `LockScope`.
 *
 * `Section`, every augment in an `AugmentSlot` and the dashboard's widget
 * guard are lock scopes, and each is a thin user of `LockScope`. A second
 * place that calls `useLockScope` or provides `LockScopeContext` itself is a
 * second copy of the rules (which claims count, what holds a scope shut, what
 * draws), and two copies drift: one would hold a lock the other releases.
 * Draw differently through `LockScope`'s `fallback` instead.
 *
 * Test files are outside the scan, so a test of the seam itself may still
 * provide the context by hand.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

const THE_IMPLEMENTATION = "packages/ui-kit/src/LockScope.tsx";

/** The sdk spine, where the seam is defined, scanned beside the UI roots. */
const SEAM_ROOT = "mod/sitrep-sdk/src";

const EXCLUDED = /\/dist\/|\.test\.|\.spec\.|test-d|__fixtures__|__generated__/;

const MINIMUM_FILES = 250;

/** The wirings a source makes outside `LockScope`: a Provider of the context, or a call of the scope hook. */
function wiringsIn(source: string): string[] {
  const found: string[] = [];
  if (/LockScopeContext\.Provider/.test(source)) {
    found.push("LockScopeContext.Provider");
  }
  // The definition is `function useLockScope(`; only a call is a wiring.
  for (const match of source.matchAll(/(\bfunction\s+)?\buseLockScope\s*\(/g)) {
    if (!match[1]) found.push("useLockScope(");
  }
  return found;
}

function scannedFiles(): string[] {
  const roots = [...styleguideScanRoots(REPO), SEAM_ROOT];
  const listed = execFileSync("git", ["ls-files", "--", ...roots], {
    cwd: REPO,
    encoding: "utf8",
  });
  return listed
    .split("\n")
    .filter((path) => /\.(ts|tsx)$/.test(path) && !EXCLUDED.test(path));
}

describe("lock scopes have one implementation", () => {
  it("wires a lock scope only inside LockScope", () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(MINIMUM_FILES);

    const offenders = files
      .filter((path) => path !== THE_IMPLEMENTATION)
      .flatMap((path) =>
        wiringsIn(readFileSync(join(REPO, path), "utf8")).map(
          (wiring) => `${path}: ${wiring}`,
        ),
      );

    expect(
      offenders,
      `These files wire a lock scope themselves:\n\n  ${offenders.join("\n  ")}\n\n` +
        "Use <LockScope> from ui-kit, and its `fallback` prop for a different drawing.",
    ).toEqual([]);
  });

  it("finds the one implementation it allows", () => {
    expect(
      wiringsIn(readFileSync(join(REPO, THE_IMPLEMENTATION), "utf8")),
    ).toEqual(["LockScopeContext.Provider", "useLockScope("]);
  });

  it("sees a violation when there is one", () => {
    const planted = [
      "export function useLockScope(standing) {}",
      "const { scope } = useLockScope();",
      "<LockScopeContext.Provider value={scope}>{children}</LockScopeContext.Provider>",
    ].join("\n");

    expect(wiringsIn(planted)).toEqual([
      "LockScopeContext.Provider",
      "useLockScope(",
    ]);
  });
});
