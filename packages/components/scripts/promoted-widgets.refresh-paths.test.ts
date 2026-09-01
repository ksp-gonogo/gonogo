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

describe("refresh-promoted-assets.yml cannot omit a promoted widget", () => {
  const yaml = readFileSync(WORKFLOW, "utf8");

  /* THE INVARIANT CHANGED, AND SO DID ITS PROOF.
   *
   * This suite was written against a `push.paths` list, and its job was to stop
   * that hand-kept list going stale in the one checkable direction: every
   * promoted widget's own directory had to be named. The list is gone. The
   * workflow now runs NIGHTLY, because it COMMITS assets back and a commit
   * landing on `staging` mid-hook rejected a developer's push and cost the whole
   * hook again, four times in one evening.
   *
   * The RISK is unchanged: a promoted widget whose asset quietly stops being
   * refreshed, when those assets are what the operator approves. The list was
   * one way to be sure and it was a poor one, because it could omit a widget
   * silently. A schedule with no filter cannot: there is nothing to omit FROM.
   *
   * So the assertions invert. What used to be "the list covers every widget"
   * becomes "there is no list to miss a widget", and both are the same claim
   * about the same risk.
   */

  it("has no paths filter, so no promoted widget can be left out of one", () => {
    expect(
      /\n\s+paths:/.test(yaml),
      `${WORKFLOW} has a paths filter again. It ran nightly with none, and a ` +
        "filter can omit a promoted widget silently, which is exactly what it " +
        "did before: it named this job's own scripts and ONE widget's " +
        "directory, so a change to the design system every promoted widget " +
        "draws through refreshed nothing.",
    ).toBe(false);
  });

  it("runs on a schedule rather than on a push that races a developer", () => {
    expect(
      /\n\s+schedule:/.test(yaml),
      `${WORKFLOW} has no schedule trigger, so nothing refreshes a promoted ` +
        "asset on its own and an approved render can go stale unnoticed.",
    ).toBe(true);
    expect(
      /\n {2}push:/.test(yaml),
      `${WORKFLOW} triggers on push again. It commits assets back, so a push ` +
        "trigger puts it in a race with anyone pushing to the same branch.",
    ).toBe(false);
  });

  it("can still be run by hand, which is how a page is healed without waiting for the night", () => {
    expect(/\n\s+workflow_dispatch:/.test(yaml)).toBe(true);
  });

  it("finds at least one promoted widget, so the suite is not vacuous", () => {
    expect(PROMOTED_WIDGETS.length).toBeGreaterThan(0);
    expect(promotedDirs().size).toBeGreaterThan(0);
  });
});
