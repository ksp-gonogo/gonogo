import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expectNoHandTypedUnits } from "@ksp-gonogo/ui-kit/guards";
import { describe, expect, it } from "vitest";

/**
 * Declining ratchet: a unit symbol must reach a reader through `<Unit>`, not
 * by being typed next to a number.
 *
 * ```
 * `${closingMagnitude.toFixed(1)} m/s`
 * ```
 *
 * Nothing in the type system objects. It renders correctly. And it is the
 * whole problem the unit layer exists to solve, one site at a time: the symbol
 * cannot be dimmed, cannot be kept off a line break, is announced to a screen
 * reader as the letters "m", "slash", "s", and does not follow when a value's
 * ladder rung changes. Eleven widgets each grew their own ladder that way
 * once, and three Uplinks did it again afterwards.
 *
 * ## The scan lives in the KIT, not here
 *
 * This file used to carry its own regex, its own CSS-length filter and its own
 * baseline bookkeeping. It now calls `@ksp-gonogo/ui-kit/guards`, and the
 * reason is the reason for every other consolidation in this layer: a rule
 * kept in two places is a rule that gets enforced two ways.
 *
 * That is not hypothetical here. `ATTACHED_SYMBOLS` was duplicated between
 * `<Unit>` and `writeQuantity` and they disagreed, so the same angle read
 * `8.0°` in a readout and `8.0 °` in the SVG label beside it. A second copy of
 * THIS rule would drift the same way, and worse: an Uplink author outside this
 * repo cannot run a private test, so they would be held to whatever their own
 * copy happened to say.
 *
 * So the kit publishes the check, this file points it at the workspace, and an
 * Uplink points it at its own `src`. One implementation, one message, one set
 * of exemptions. See `docs/creating-an-uplink.md`.
 */

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * Every source root the guard should walk, found rather than listed.
 *
 * `packages/<name>/src` plus `mod/<name>/client/src`. The Uplinks were outside
 * this scan for as long as it existed, which is exactly how three of them kept
 * typing their own symbols while every widget in `packages` stopped.
 */
function sourceRoots(): string[] {
  const found: string[] = [];
  for (const workspace of ["packages", "mod"]) {
    const base = join(root, workspace);
    for (const entry of readdirSync(base)) {
      for (const candidate of [
        join(base, entry, "src"),
        join(base, entry, "client", "src"),
      ]) {
        try {
          if (statSync(candidate).isDirectory()) found.push(candidate);
        } catch {
          // Not every workspace member has one; that is not an error.
        }
      }
    }
  }
  return found;
}

/**
 * Empty, and it stays empty.
 *
 * Every readout in the workspace renders through `<Unit>`, or through
 * `writeQuantity` where the text lands somewhere a node cannot go (an SVG
 * `<text>`, a canvas), or through `speakQuantity` where it is an accessible
 * name. Eleven private ladders went with them, and then eight more sites
 * across three Uplinks.
 *
 * Keyed on the path RELATIVE to its source root, which is what the guard
 * reports, so an entry reads `Foo/index.tsx` rather than the whole path.
 *
 * A new entry here is a regression, not a backlog item. Convert the site.
 */
const BASELINE: Record<string, number> = {};

describe("design-system: units reach a reader through <Unit>", () => {
  it("adds no new place that types a unit symbol next to a number", () => {
    const roots = sourceRoots();
    // A guard with nothing to scan is broken, not passing. This workspace has
    // already had one scan quietly cover less than it claimed to.
    expect(roots.length).toBeGreaterThan(10);

    for (const dir of roots) {
      expectNoHandTypedUnits({ dir, baseline: BASELINE });
    }
  });
});
