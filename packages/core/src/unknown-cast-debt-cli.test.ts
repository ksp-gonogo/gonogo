// @vitest-environment node
// Node realm rather than the package's jsdom default: this spawns the generator.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `node scripts/unknown-cast-debt.mjs --update` must refuse a rewrite it was
 * not scoped to.
 *
 * The floors at the foot of `unknown-cast.debt.ts` are derived from what the
 * walk COVERS rather than from the debt, so they move whenever files land
 * anywhere in the tree. A full rewrite puts that movement in the same diff as
 * the one key somebody meant to record, and the two read alike: it has already
 * been misread once, as the floors depending on which checkout regenerated
 * them. `--only` records keys and carries every floor through untouched;
 * `--all` is the deliberate spelling for reseeding them.
 *
 * Asserted from outside the script rather than trusted to its own source,
 * because the refusal has to happen BEFORE the measurement. The scan builds a
 * TypeScript program over every root, which is a minute of waiting to be told
 * about an argument, and someone who has waited that long re-runs with whatever
 * makes the complaint stop. A spawn that answers in milliseconds is also the
 * proof that nothing was measured first.
 */
describe("the unknown-cast debt generator refuses an unscoped --update", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const script = "scripts/unknown-cast-debt.mjs";
  const debtList = join(repoRoot, "packages/core/src/unknown-cast.debt.ts");

  /** The census's first line, and so the proof that the scan has run. */
  const CENSUS = /assertions out of unknown\/any across/;

  function run(args: string[], timeout = 30_000) {
    return spawnSync("node", [script, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout,
    });
  }

  const refusals: { args: string[]; says: RegExp }[] = [
    { args: ["--update"], says: /Refusing an unscoped --update/ },
    { args: ["--update", "--only"], says: /--only needs a path substring/ },
    {
      args: ["--update", "--only", "packages/ui-kit", "--all"],
      says: /--only and --all are alternatives/,
    },
  ];

  for (const { args, says } of refusals) {
    it(`refuses \`${args.join(" ")}\` before measuring anything`, () => {
      const before = readFileSync(debtList, "utf8");
      const result = run(args);

      expect(result.status, `stderr:\n${result.stderr}`).toBe(1);
      expect(result.stderr).toMatch(says);
      expect(
        `${result.stdout}${result.stderr}`,
        "the census ran before the refusal, so the guard sits downstream of the scan",
      ).not.toMatch(CENSUS);
      /*
       * The generator writes in place, so a guard that stopped firing would
       * fail nothing: it would rewrite the list under the next person who
       * regenerated.
       */
      expect(
        readFileSync(debtList, "utf8"),
        "a refused run rewrote the debt list anyway",
      ).toBe(before);
    });
  }

  it("names both remedies, spelled the way the parser reads them", () => {
    const result = run(["--update"]);
    expect(result.stderr).toContain("--update --only");
    expect(result.stderr).toContain("--update --all");
    // A refusal naming a flag the script no longer parses reads as a bug in the
    // caller, so the spellings are checked against the parser too.
    const source = readFileSync(join(repoRoot, script), "utf8");
    expect(source).toContain('args.indexOf("--only")');
    expect(source).toContain('args.includes("--all")');
  });

  /**
   * The control. Every refusal above is argument parsing, so a generator broken
   * into refusing everything would pass all three and this file would report a
   * working guard over a dead tool.
   *
   * A scoped run is accepted and then spends a minute building a TypeScript
   * program, which is far too long to wait here, so it is cut short: what is
   * being asked is whether the arguments got through, and a refusal would have
   * arrived in milliseconds. Should it ever finish inside the window, it writes
   * the list it would have written anyway, which on an unchanged tree is the
   * list already there.
   */
  it("accepts a scoped --update and goes on to measure", () => {
    const result = run(["--update", "--only", "packages/ui-kit"], 4_000);
    for (const { says } of refusals) {
      expect(`${result.stdout}${result.stderr}`).not.toMatch(says);
    }
    expect(
      result.status === null || result.status === 0,
      `a scoped --update exited ${result.status}:\n${result.stderr}`,
    ).toBe(true);
  });
});
