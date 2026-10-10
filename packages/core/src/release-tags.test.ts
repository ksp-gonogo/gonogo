// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HOLDING_TAG,
  moveTogether,
  nugetLists,
  planMoves,
  restoreCommand,
} from "../../../scripts/release-tags.mjs";

/**
 * The packages are published as a set: no dist-tag an author installs by moves
 * until every package exists on its registry, and then they all move together.
 * What holds here is that a tag that cannot be moved leaves the set as it was
 * found, and that the workflow publishes under the holding tag and moves the
 * real one in one place only.
 */

const SDK = "@ksp-gonogo/sitrep-sdk";
const KIT = "@ksp-gonogo/ui-kit";
const TOOLS = "@ksp-gonogo/uplink-tools";

const before = {
  [SDK]: { latest: "0.0.1", rc: "1.0.0-rc.14" },
  [KIT]: { latest: "0.1.0", rc: "1.0.0-rc.14" },
  [TOOLS]: { latest: "0.0.0" },
};

/** An npm that records what it was asked and fails on the calls a test names. */
function fakeNpm(failing: (args: string[]) => boolean = () => false) {
  const calls: string[] = [];
  const npm = (args: string[]) => {
    calls.push(args.join(" "));
    if (failing(args)) throw new Error("E403 not allowed");
  };
  return { calls, npm };
}

describe("planning the move", () => {
  it("moves the tag for every package, noting where each pointed", () => {
    expect(planMoves(before, "rc", "1.0.0-rc.16")).toEqual([
      { name: SDK, from: "1.0.0-rc.14", to: "1.0.0-rc.16", needed: true },
      { name: KIT, from: "1.0.0-rc.14", to: "1.0.0-rc.16", needed: true },
      { name: TOOLS, from: undefined, to: "1.0.0-rc.16", needed: true },
    ]);
  });

  it("leaves alone a package whose tag is already there, which is what a second run finds", () => {
    const half = { ...before, [SDK]: { rc: "1.0.0-rc.16" } };
    expect(
      planMoves(half, "rc", "1.0.0-rc.16").map((move) => move.needed),
    ).toEqual([false, true, true]);
  });
});

describe("moving the tags together", () => {
  it("moves each in turn and reports what it moved", () => {
    const { calls, npm } = fakeNpm();
    const moved = moveTogether(
      planMoves(before, "rc", "1.0.0-rc.16"),
      "rc",
      npm,
      () => {},
    );
    expect(calls).toEqual([
      `dist-tag add ${SDK}@1.0.0-rc.16 rc`,
      `dist-tag add ${KIT}@1.0.0-rc.16 rc`,
      `dist-tag add ${TOOLS}@1.0.0-rc.16 rc`,
    ]);
    expect(moved).toHaveLength(3);
  });

  it("puts back every tag it had moved when one cannot be moved, newest first", () => {
    const { calls, npm } = fakeNpm((args) =>
      args.join(" ").includes(`add ${TOOLS}@`),
    );
    expect(() =>
      moveTogether(planMoves(before, "rc", "1.0.0-rc.16"), "rc", npm, () => {}),
    ).toThrow(
      /could not move rc for @ksp-gonogo\/uplink-tools[\s\S]*back where it was/,
    );
    expect(calls.slice(3)).toEqual([
      `dist-tag add ${KIT}@1.0.0-rc.14 rc`,
      `dist-tag add ${SDK}@1.0.0-rc.14 rc`,
    ]);
  });

  it("removes a tag the package did not carry before, when putting it back", () => {
    expect(
      restoreCommand(
        { name: TOOLS, from: undefined, to: "1.0.0-rc.16", needed: true },
        "rc",
      ),
    ).toEqual(["dist-tag", "rm", TOOLS, "rc"]);
  });

  it("names the commands to run by hand when a tag cannot be put back either", () => {
    const { npm } = fakeNpm(
      (args) =>
        args.join(" ").includes(`add ${KIT}@1.0.0-rc.16`) ||
        args.join(" ").includes(`add ${SDK}@1.0.0-rc.14`),
    );
    expect(() =>
      moveTogether(planMoves(before, "rc", "1.0.0-rc.16"), "rc", npm, () => {}),
    ).toThrow(
      /could NOT be put back[\s\S]*npm dist-tag add @ksp-gonogo\/sitrep-sdk@1\.0\.0-rc\.14 rc/,
    );
  });

  it("makes no call at all when nothing needs moving", () => {
    const there = Object.fromEntries(
      Object.keys(before).map((name) => [name, { rc: "1.0.0-rc.16" }]),
    );
    const { calls, npm } = fakeNpm();
    moveTogether(planMoves(there, "rc", "1.0.0-rc.16"), "rc", npm, () => {});
    expect(calls).toEqual([]);
  });
});

describe("nuget.org's listing", () => {
  it("is read from the flat container's index, which spells versions in lower case", () => {
    const index = { versions: ["1.0.0-rc.14", "1.0.0-rc.16"] };
    expect(nugetLists(index, "1.0.0-RC.16")).toBe(true);
    expect(nugetLists(index, "1.0.0-rc.15")).toBe(false);
    expect(nugetLists(undefined, "1.0.0")).toBe(false);
  });
});

describe("release.yml publishes the packages as a set", () => {
  const workflow = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../.github/workflows/release.yml",
    ),
    "utf8",
  );

  it("publishes to npm under the holding tag only", () => {
    const publishes = workflow
      .split("\n")
      .filter((line) => /^\s+(run: )?npm publish /.test(line));
    expect(publishes.length).toBeGreaterThanOrEqual(2);
    for (const line of publishes) {
      expect(line).toContain(`--tag ${HOLDING_TAG}`);
    }
  });

  it("moves a dist-tag in one job, after nuget.org lists the package and npm serves every version", () => {
    const job = (name: string) => {
      const start = workflow.indexOf(`\n  ${name}:\n`);
      expect(start, `the ${name} job`).toBeGreaterThan(-1);
      const next = workflow.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
      return workflow.slice(start, next === -1 ? undefined : start + 1 + next);
    };
    expect(job("nuget-listed")).toMatch(/needs: \[publish-nuget\]/);
    expect(job("publish-packages")).toMatch(/needs: \[.*nuget-listed.*\]/);
    expect(job("publish-packages")).toContain(
      "needs.nuget-listed.result == 'success'",
    );
    expect(job("packages-present")).toMatch(/needs: \[publish-packages\]/);
    expect(job("move-tags")).toContain(
      "needs.packages-present.result == 'success'",
    );
    // The only place a tag is moved is the script, called from the one job.
    const movers = workflow
      .split("\n")
      .filter((line) => /release-tags\.mjs move /.test(line));
    expect(movers).toHaveLength(1);
    expect(job("move-tags")).toContain(movers[0]);
    expect(workflow).not.toMatch(/^\s+(run: )?npm dist-tag (add|rm) /m);
  });

  it("refuses a real publish dispatched from any ref but main or a release tag", () => {
    const start = workflow.indexOf("\n  ref-guard:\n");
    expect(start, "the ref-guard job").toBeGreaterThan(-1);
    const guard = workflow.slice(
      start,
      workflow.indexOf("\n  rc-plan:", start),
    );
    expect(guard).toContain("refs/heads/main");
    expect(guard).toContain("refs/tags/v*");
    expect(guard).toContain("!inputs.dry_run");
    for (const name of ["publish-nuget", "publish-packages"]) {
      const at = workflow.indexOf(`\n  ${name}:\n`);
      const head = workflow.slice(at, at + 1500);
      expect(head, name).toMatch(/needs: \[ref-guard,/);
      expect(head, name).toContain("needs.ref-guard.result == 'success'");
    }
  });

  it("probes the packed packages before either registry is pushed to", () => {
    for (const name of ["publish-nuget", "publish-packages"]) {
      const at = workflow.indexOf(`\n  ${name}:\n`);
      const head = workflow.slice(at, at + 1800);
      expect(head, name).toMatch(/needs: \[ref-guard, packages-probe,/);
      expect(head, name).toContain("needs.packages-probe.result == 'success'");
    }
    const at = workflow.indexOf("\n  packages-probe:\n");
    expect(at, "the packages-probe job").toBeGreaterThan(-1);
    expect(workflow.slice(at, at + 1800)).toContain(
      "node scripts/published-packages-probe.mjs\n",
    );
  });
});
