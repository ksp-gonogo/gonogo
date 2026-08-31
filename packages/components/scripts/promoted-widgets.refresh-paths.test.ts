// @vitest-environment node
//
// Node realm: this reads a workflow file off disk.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROMOTED_WIDGETS } from "./promoted-widgets";

/**
 * Does `refresh-promoted-assets.yml` still trigger on the widgets it refreshes?
 *
 * That workflow re-renders the promoted widgets' assets on the CI runner and
 * commits them back, and **these are the renders sent to the operator for
 * approval**, so an approved picture that quietly stops matching the code is the
 * whole risk it exists to remove. Its `push.paths` list decides when it runs, and
 * a GitHub Actions `paths:` list is static YAML: it cannot be computed from
 * `promoted-widgets.ts`, which is the file that actually knows the answer.
 *
 * So the list is hand-kept, and it has already been wrong once in a way nothing
 * could see: it named this job's own scripts and one widget's directory, and
 * omitted `packages/ui-kit`, so a change to the design system every promoted
 * widget is built out of refreshed nothing. It was also `branches: [main]` while
 * every branch in the repo merged to `staging`, so it had not run at all.
 *
 * Both of those were true when written and had no mechanism keeping them true.
 * This is the mechanism. It cannot make the list correct, and it can refuse to let
 * it go stale in the one direction that is checkable: **every promoted widget's
 * own source directory must be covered.**
 *
 * ## What it deliberately does NOT check
 *
 * Whether the list is COMPLETE in the sense of naming everything whose change
 * could alter a promoted render. That set is the transitive dependency graph of
 * four widgets, which is most of the repo, and a paths list naming most of the
 * repo is a paths list with no filter in it. `packages/ui-kit` is on the list
 * because it is the design system every widget draws through, and that is a
 * judgement rather than a derivation.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = resolve(
  HERE,
  "../../../.github/workflows/refresh-promoted-assets.yml",
);
const SRC = "packages/components/src";

/** The `push.paths` entries, read out of the YAML by shape rather than parsed. */
function triggerPaths(yaml: string): string[] {
  const push = yaml.indexOf("\n  push:");
  expect(push, `${WORKFLOW} has no push trigger`).toBeGreaterThan(-1);
  const paths = yaml.indexOf("paths:", push);
  expect(paths, `${WORKFLOW}'s push trigger has no paths list`).toBeGreaterThan(
    -1,
  );
  const out: string[] = [];
  for (const line of yaml.slice(paths).split("\n").slice(1)) {
    const entry = /^\s+-\s+'([^']+)'\s*$/.exec(line);
    if (!entry?.[1]) break;
    out.push(entry[1]);
  }
  return out;
}

/**
 * Source directories, under `packages/components/src`, that the promoted set
 * reaches.
 *
 * Two routes, because a still and a GIF name their source differently: a still
 * carries a `fixtureFile` whose first segment IS the widget's directory, and a
 * GIF builds its frames in code and carries no path, so its widget is found by
 * the registration that declares its `widgetId`.
 */
function promotedDirs(): Set<string> {
  const dirs = new Set<string>();
  for (const widget of PROMOTED_WIDGETS) {
    for (const still of widget.stills ?? []) {
      const first = still.fixtureFile.split("/")[0];
      if (first) dirs.add(first);
    }
    dirs.add(dirForWidgetId(widget.widgetId));
  }
  return dirs;
}

/**
 * The directory whose registration declares this widget id, found rather than
 * mapped. A hand-kept id-to-directory table here would be the same class of
 * thing this file exists to police.
 */
function dirForWidgetId(widgetId: string): string {
  const root = resolve(HERE, "../src");
  for (const entry of readdirSync(root)) {
    const dir = resolve(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of ["index.tsx", "index.ts"]) {
      const candidate = resolve(dir, file);
      if (!existsSync(candidate)) continue;
      const source = readFileSync(candidate, "utf8");
      if (source.includes(`id: "${widgetId}"`)) return entry;
    }
  }
  throw new Error(
    `no registration under ${SRC} declares id: "${widgetId}", so this test ` +
      "cannot find the directory whose changes should refresh its asset. " +
      "Either the id moved or the registration is not in a directory index.",
  );
}

/** Does any trigger entry cover `packages/components/src/<dir>/…`? */
function covered(paths: readonly string[], dir: string): boolean {
  const target = `${SRC}/${dir}/`;
  return paths.some((entry) => {
    const prefix = entry.replace(/\*+$/, "");
    return target.startsWith(prefix) || entry === `${SRC}/${dir}/**`;
  });
}

describe("refresh-promoted-assets.yml triggers on what it refreshes", () => {
  const yaml = readFileSync(WORKFLOW, "utf8");
  const paths = triggerPaths(yaml);

  it("reads a non-empty paths list, so a passing assertion below means something", () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  it("finds at least one promoted widget, for the same reason", () => {
    expect(PROMOTED_WIDGETS.length).toBeGreaterThan(0);
    expect(promotedDirs().size).toBeGreaterThan(0);
  });

  it("covers every promoted widget's own source directory", () => {
    const missing = [...promotedDirs()]
      .filter((dir) => !covered(paths, dir))
      .sort();
    expect(
      missing,
      `${WORKFLOW}'s push.paths does not cover ${missing.length} promoted ` +
        `widget director${missing.length === 1 ? "y" : "ies"}, so a change ` +
        "there will not refresh the asset and nothing else will notice. Add " +
        `${missing.map((d) => `'${SRC}/${d}/**'`).join(", ")}.`,
    ).toEqual([]);
  });

  it("keeps the design system on the list, because every promoted render draws through it", () => {
    expect(paths.some((p) => p.startsWith("packages/ui-kit"))).toBe(true);
  });

  it("runs on the branch the work lands on", () => {
    const branches = /\n {2}push:\s*\n\s+branches:\s*\[([^\]]+)\]/.exec(yaml);
    expect(branches?.[1], `${WORKFLOW} has no push branches list`).toBeTruthy();
    expect(branches?.[1]).toContain("staging");
  });

  // The planted case, because a checker that cannot see a violation reports zero
  // and zero reads as success.
  it("would SEE an uncovered directory", () => {
    expect(covered(paths, "SomeWidgetNobodyListed")).toBe(false);
    expect(covered(paths, "LandingStatus")).toBe(true);
  });
});
