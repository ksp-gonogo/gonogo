import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasCommandHome, isKnownCommandGap } from "@gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import { ACTION_GROUPS } from "../actionGroups";

/**
 * Coverage gate for the M3 `mapCommand` command table — the write-half twin
 * of `mapTopic.coverage.test.ts`. Every legacy Telemachus action key a real
 * widget's `useExecuteAction("data")`-bound `execute(...)` call actually
 * fires must be either mapped to a new command (`mapCommand("data", key)`
 * resolves for SOME reachable current-value/arg combination) or explicitly
 * listed as a known gap (`isKnownCommandGap`). Anything neither mapped nor
 * gap-listed is a silent miss: a widget action nobody audited would quietly
 * keep working off legacy forever with no signal that it was never
 * considered for migration.
 *
 * Scans `packages/components/src` directly (mirroring `mapTopic.coverage
 * .test.ts`'s own scan) so a newly-added widget action fails CI immediately
 * instead of slipping through unaudited.
 */

const COMPONENTS_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "components",
  "src",
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
 * backticks immediately after `execute(`) to its base key — everything
 * before the first `[` (a legacy bracketed-args suffix, e.g.
 * `"f.setSASMode[StabilityAssist]"`) or `${` (a template-literal
 * interpolation, e.g. `` `f.setThrottle[${v}]` `` — the `[` already wins
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
 * Every literal `execute("...")` / `` execute(`...`) `` call site across
 * `packages/components/src`, reduced to base action keys. Deliberately
 * matches ANY `execute(` call (not just ones on a variable literally named
 * `execute`) — every real call site in the widget set today happens to use
 * that name (`const execute = useExecuteAction("data")`), and scanning the
 * call shape rather than requiring a specific binding name is both simpler
 * and more future-proof. `KosProcessors`' `executeKos(...)` calls are NOT
 * matched (`execute\(` requires "execute" immediately followed by "(", which
 * "executeKos(" never satisfies) — correctly excluded, since that hook is
 * bound to `dataSourceId: "kos"`, which `mapCommand` never routes.
 */
function collectWidgetCommandActions(): Set<string> {
  const keys = new Set<string>();
  for (const file of listSourceFiles(COMPONENTS_SRC)) {
    const source = readFileSync(file, "utf-8");

    for (const match of source.matchAll(/execute\(\s*"([^"]*)"/g)) {
      keys.add(extractActionKey(match[1]));
    }
    for (const match of source.matchAll(/execute\(\s*`([^`]*)`/g)) {
      keys.add(extractActionKey(match[1]));
    }
  }
  return keys;
}

/**
 * Action keys resolved dynamically instead of as a literal
 * `execute("<key>")`/`` execute(`<key>`) `` call, so the regex scan above
 * can never see them — the write-half analog of `mapTopic.coverage.test
 * .ts`'s `collectDynamicTelemachusKeys`.
 *
 * - `ActionGroup` (`packages/components/src/ActionGroup/index.tsx`) fires
 *   `execute(group.toggle)`, resolved at runtime from `@gonogo/core`'s
 *   `ACTION_GROUPS` registry.
 * - `ManeuverPlanner` (`packages/components/src/ManeuverPlanner/index.tsx`)
 *   builds `o.addManeuverNode[...]`/`o.updateManeuverNode[...]` into a local
 *   `const action` before calling `execute(action)` (`dispatchPlanBurns`/
 *   `handleEdit`) — a variable reference the regex scan can't follow.
 *   `o.removeManeuverNode[...]` is called directly as a template literal at
 *   every one of its call sites (`ManeuverPlanner/index.tsx`,
 *   `BurnCompletionTracker.ts`) and IS caught by the scan above.
 */
function collectDynamicCommandActions(): Set<string> {
  const keys = new Set<string>();
  for (const group of ACTION_GROUPS) {
    if (group.toggle) keys.add(group.toggle);
  }
  keys.add("o.addManeuverNode");
  keys.add("o.updateManeuverNode");
  return keys;
}

describe("mapCommand coverage — every widget action key is mapped or a declared gap", () => {
  const widgetActions = new Set([
    ...collectWidgetCommandActions(),
    ...collectDynamicCommandActions(),
  ]);

  it("found a non-trivial number of widget action keys (scan sanity check)", () => {
    expect(widgetActions.size).toBeGreaterThan(20);
  });

  it("maps or explicitly gaps every widget action key — no silent misses", () => {
    // `hasCommandHome` is a plain key-existence check (was this action ever
    // audited and given a home), not a full `mapCommand` resolution — several
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

  it("mapped keys and known gaps are mutually exclusive for every widget action key", () => {
    const bothMappedAndGapped = [...widgetActions].filter(
      (key) => hasCommandHome("data", key) && isKnownCommandGap("data", key),
    );

    expect(bothMappedAndGapped).toEqual([]);
  });
});
