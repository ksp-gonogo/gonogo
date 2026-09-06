// @vitest-environment node
//
// Node realm rather than the package's jsdom default: this spawns the gate.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `pnpm act-warning-gate --update` must refuse a rewrite it was not scoped to.
 *
 * The act debt is a per-file count of a RACE: the same file measures 0, 1 and 21
 * on an unchanged tree depending on machine load. So a rewrite of the whole list
 * from one run writes that run's roll for every file the commit never touched,
 * and it lands inside a diff that says it fixed something else. `--only` names
 * what was fixed; `--all` is the deliberate spelling for a reseed.
 *
 * Asserted from outside the script rather than trusted to its own source,
 * because the refusal has to happen BEFORE the measurement: the check used to
 * sit after the walk of every package, which is minutes of waiting to be told
 * about an argument, and a person who has waited that long re-runs with
 * whatever makes the complaint stop. A test that spawns it and gets an answer
 * back in milliseconds is also the proof that nothing was measured first.
 */
describe("the act-warning gate refuses an unscoped --update", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const gate = "scripts/act-warning-gate.mjs";

  function run(args: string[]) {
    return spawnSync("node", [gate, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      // Long enough to fail the test rather than hang the suite if the refusal
      // is ever moved back behind the measurement, which is exactly what this
      // is here to notice.
      timeout: 30_000,
    });
  }

  it("refuses --update with neither --only nor --all", () => {
    const result = run(["--update"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Refusing an unscoped --update/);
    // The remedy, not just the refusal: both spellings, since which one is right
    // depends on whether you fixed four files or are reseeding the list.
    expect(result.stderr).toContain("--update --only");
    expect(result.stderr).toContain("--update --all");
  });

  it("refuses --update under --filter, which measures only part of the tree", () => {
    const result = run(["--update", "--filter", "ui"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Refusing to --update under --filter/);
  });

  /**
   * The control. Both refusals above are argument parsing, so a gate that had
   * been broken into refusing everything would pass them both and this file
   * would report a working guard over a dead tool.
   */
  it("does not refuse a run without --update, which reaches package discovery", () => {
    const result = run(["--filter", "no-such-pkg"]);
    expect(result.stderr).not.toMatch(/Refusing/);
    expect(`${result.stdout}${result.stderr}`).toMatch(
      /matched no package with a test script/,
    );
  });
});
