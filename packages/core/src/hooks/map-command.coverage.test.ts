import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasCommandHome, isKnownCommandGap } from "@ksp-gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import { STOCK_ACTION_GROUPS } from "../actionGroups";

/**
 * Coverage gate for the `mapCommand` command table, the write-half twin of
 * `mapTopic.coverage.test.ts`. Every legacy action key anything in the app
 * still dispatches must be either mapped to a new command (`mapCommand("data",
 * key)` resolves for SOME reachable current-value/arg combination) or
 * explicitly listed as a known gap (`isKnownCommandGap`). Anything neither
 * mapped nor gap-listed is a silent miss: an action nobody audited would
 * quietly keep working off legacy forever with no signal that it was never
 * considered for migration.
 *
 * **Where the legacy action strings live now.** The widget half is gone: no
 * component binds a `(action: string) => Promise<void>` dispatcher any more
 * (`useExecuteAction`, the last one, was deleted with its final two callers).
 * What survives is `dispatchActiveCommand(dataSourceId, action)`, the non-hook
 * router the alarm effects, GO/NO-GO stage effects and maneuver triggers use
 * from plain classes, so the scan covers `packages/app/src` alongside
 * `packages/components/src` and matches that call as well as `execute(...)`.
 * Keeping `execute(...)` in the pattern is deliberate: it is what catches a
 * widget reaching back for a string-action dispatcher.
 */

const SCAN_ROOTS = ["components", "app"].map((pkg) =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", pkg, "src"),
);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.(tsx|ts)$/.test(entry)) continue;
    if (entry.includes(".test.")) continue;
    out.push(full);
  }
  return out;
}

/**
 * Reduces a raw action-string literal (the content between the quotes/
 * backticks immediately after `execute(`) to its base key, everything
 * before the first `[` (a legacy bracketed-args suffix, e.g.
 * `"f.setSASMode[StabilityAssist]"`) or `${` (a template-literal
 * interpolation, e.g. `` `f.setThrottle[${v}]` ``: the `[` already wins
 * here, but a key can in principle interpolate before any bracket at all).
 */
function extractActionKey(raw: string): string {
  const bracketIdx = raw.indexOf("[");
  const templateIdx = raw.indexOf("${");
  let cut = raw.length;
  if (bracketIdx !== -1) cut = Math.min(cut, bracketIdx);
  if (templateIdx !== -1) cut = Math.min(cut, templateIdx);
  return raw.slice(0, cut);
}

/**
 * Every literal action string handed to `execute(...)` or, as its second
 * argument, to `dispatchActiveCommand(...)` across the scan roots, reduced to
 * base action keys. `execute(` deliberately matches ANY receiver rather than a
 * specific binding name: scanning the call shape is both simpler and more
 * future-proof. `KosProcessors`' `executeKos(...)` calls are NOT matched
 * (`execute\(` requires "execute" immediately followed by "(", which
 * "executeKos(" never satisfies): correctly excluded, since that hook is
 * bound to `dataSourceId: "kos"`, which `mapCommand` never routes.
 */
const LITERAL_ACTION_PATTERNS = [
  /execute\(\s*"([^"]*)"/g,
  /execute\(\s*`([^`]*)`/g,
  /dispatchActiveCommand\([^,)]*,\s*"([^"]*)"/g,
  /dispatchActiveCommand\([^,)]*,\s*`([^`]*)`/g,
];

function collectLiteralCommandActions(): Set<string> {
  const keys = new Set<string>();
  for (const root of SCAN_ROOTS) {
    for (const file of listSourceFiles(root)) {
      const source = readFileSync(file, "utf-8");
      for (const pattern of LITERAL_ACTION_PATTERNS) {
        for (const match of source.matchAll(pattern)) {
          keys.add(extractActionKey(match[1]));
        }
      }
    }
  }
  return keys;
}

/**
 * Action keys resolved dynamically instead of as a literal
 * `execute("<key>")`/`` execute(`<key>`) `` call, so the regex scan above
 * can never see them.
 *
 * - `ActionGroup` (`packages/components/src/ActionGroup/index.tsx`) fires
 *   `execute(group.toggle)`, resolved at runtime from the action-group
 *   registry. Note the READ half of this blind spot is gone (the widget now
 *   reads canonical Topics; see `mapTopic.coverage.test.ts`); only the WRITE
 *   half survives, because a toggle is still registry-resolved.
 * - `ManeuverPlanner` (`packages/components/src/ManeuverPlanner/index.tsx`)
 *   builds `o.addManeuverNode[...]`/`o.updateManeuverNode[...]` into a local
 *   `const action` before calling `execute(action)` (`dispatchPlanBurns`/
 *   `handleEdit`): a variable reference the regex scan can't follow.
 *   `o.removeManeuverNode[...]` is called directly as a template literal at
 *   every one of its call sites (`ManeuverPlanner/index.tsx`,
 *   `BurnCompletionTracker.ts`) and IS caught by the scan above.
 *
 * The registry is no longer a static literal this can iterate: its CUSTOM half
 * derives from live telemetry (`useActionGroups`), so the toggles a running app
 * can produce depend on which backend the mod elected. This enumerates what
 * STOCK can emit, the stock singletons, plus `f.ag1`..`f.ag10` for stock's ten
 * customs (`useActionGroups` builds each custom toggle as `f.ag{index}`).
 *
 * An AGX backend would extend that to `f.ag250`. Those are deliberately NOT
 * enumerated here: `mapCommand` routes the whole `f.ag{n}` family through one
 * parametric rule, so pinning the stock range is what actually guards the
 * mapping, and asserting 250 hardcoded keys would test the arithmetic rather
 * than the routing.
 */
const STOCK_CUSTOM_GROUP_COUNT = 10;

function collectDynamicCommandActions(): Set<string> {
  const keys = new Set<string>();
  for (const group of STOCK_ACTION_GROUPS) {
    if (group.toggle) keys.add(group.toggle);
  }
  for (let i = 1; i <= STOCK_CUSTOM_GROUP_COUNT; i++) {
    keys.add(`f.ag${i}`);
  }
  keys.add("o.addManeuverNode");
  keys.add("o.updateManeuverNode");
  return keys;
}

describe("mapCommand coverage: every dispatched action key is mapped or a declared gap", () => {
  const literalActions = collectLiteralCommandActions();
  const widgetActions = new Set([
    ...literalActions,
    ...collectDynamicCommandActions(),
  ]);

  // Two separate floors, because the two halves fail in different ways and one
  // number cannot say which broke. The dynamic half is a hardcoded enumeration
  // that can only break by being edited; the FILE SCAN is the half that can
  // silently start matching nothing (a moved root, a renamed extension, a
  // regex that stopped applying) and then report a clean codebase while
  // reading no files at all.
  it("the file scan is actually finding literal action strings", () => {
    expect(literalActions.size).toBeGreaterThan(0);
  });

  it("found a non-trivial number of action keys overall (scan sanity check)", () => {
    expect(widgetActions.size).toBeGreaterThan(15);
  });

  it("maps or explicitly gaps every dispatched action key, no silent misses", () => {
    // `hasCommandHome` is a plain key-existence check (was this action ever
    // audited and given a home), not a full `mapCommand` resolution, several
    // homes need real positional args or a live current-value reader to
    // actually build a command (see map-command.ts's `hasCommandHome` doc
    // comment), which a bare base-key probe here can't supply.
    const unaccounted = [...widgetActions]
      .filter(
        (key) =>
          !hasCommandHome("data", key) && !isKnownCommandGap("data", key),
      )
      .sort();

    expect(unaccounted).toEqual([]);
  });

  it("mapped keys and known gaps are mutually exclusive for every dispatched action key", () => {
    const bothMappedAndGapped = [...widgetActions].filter(
      (key) => hasCommandHome("data", key) && isKnownCommandGap("data", key),
    );

    expect(bothMappedAndGapped).toEqual([]);
  });
});
