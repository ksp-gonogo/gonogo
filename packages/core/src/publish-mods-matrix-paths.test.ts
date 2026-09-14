import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `publish-mods.yml`'s `build-mod` matrix names a `csproj` and (sometimes) a
 * `notice` file per leg. Only two triggers exercise it (a CI-green push to
 * `main`, and a release dispatch), and `main` has not moved since 2026-07-13,
 * so a leg whose Uplink moved out from under it (GonogoScansatUplink went to
 * the `gonogo-uplinks` repo) can sit broken for months with every other gate
 * green. The matrix is data GitHub Actions never validates until the job
 * actually runs, so nothing catches a stale path but a check that reads it.
 *
 * This parses the `matrix: include:` YAML block itself rather than grepping
 * for one known-bad leg id: a hand search for `GonogoScansatUplink` would
 * catch this one departed Uplink and nothing about the next one.
 */

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const WORKFLOW = ".github/workflows/publish-mods.yml";

type MatrixEntry = Record<string, string>;

/** A quoted or bare YAML scalar, as this file's matrix entries write them. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Reads the `matrix: include:` block of a `strategy:` section: a YAML list
 * of maps, one per CI leg. Walks lines by indentation rather than depending
 * on a general YAML library, the same choice `ci-mandatory-steps.test.ts`
 * and `uplink-matrix-coverage.test.ts` made next door: the shape being read
 * is a handful of flat `key: value` pairs per list item, not arbitrary YAML.
 *
 * A line starting a new item (`- key: value`) opens a new entry; a plain
 * `key: value` line adds to the entry currently open; anything at or above
 * `include:`'s own indent ends the block.
 */
function parseMatrixInclude(yaml: string): MatrixEntry[] {
  const lines = yaml.split("\n");
  const includeAt = lines.findIndex((line) => /^\s*include:\s*$/.test(line));
  if (includeAt === -1) {
    throw new Error(`No \`include:\` list found in ${WORKFLOW}`);
  }
  const includeIndent = lines[includeAt].search(/\S/);

  const entries: MatrixEntry[] = [];
  let current: MatrixEntry | null = null;

  for (let i = includeAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.search(/\S/);
    if (indent <= includeIndent) break;

    const itemStart = /^\s*-\s*([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (itemStart) {
      if (current) entries.push(current);
      current = { [itemStart[1]]: unquote(itemStart[2]) };
      continue;
    }

    const field = /^\s*([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (field && current) {
      current[field[1]] = unquote(field[2]);
    }
  }
  if (current) entries.push(current);
  return entries;
}

const workflowText = readFileSync(join(ROOT, WORKFLOW), "utf8");
const matrix = parseMatrixInclude(workflowText);

describe("publish-mods.yml's matrix names paths that exist", () => {
  it("parsed something, so the checks below mean something", () => {
    // Guards the parser itself: a regressed `include:` match or indentation
    // read would collapse this to an empty list, and every check after this
    // one would then pass by comparing against nothing.
    expect(matrix.length).toBeGreaterThanOrEqual(5);
    for (const entry of matrix) {
      expect(entry.id, JSON.stringify(entry)).toBeTruthy();
      expect(entry.csproj, `${entry.id} has no csproj field`).toBeTruthy();
    }
  });

  it("every leg's csproj exists in the repo", () => {
    const missing = matrix.filter(
      (entry) => !existsSync(join(ROOT, entry.csproj)),
    );
    expect(
      missing.map((entry) => `${entry.id}: ${entry.csproj}`),
      "A publish-mods.yml matrix leg names a csproj that is not in the tree. " +
        "That leg cannot build; either the Uplink moved out (drop the leg) or " +
        "the path is wrong.",
    ).toEqual([]);
  });

  it("every leg's non-empty notice file exists in the repo", () => {
    const missing = matrix.filter(
      (entry) => entry.notice && !existsSync(join(ROOT, entry.notice)),
    );
    expect(
      missing.map((entry) => `${entry.id}: ${entry.notice}`),
      "A publish-mods.yml matrix leg names a notice file that is not in the tree.",
    ).toEqual([]);
  });
});
