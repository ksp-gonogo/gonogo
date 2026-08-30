#!/usr/bin/env node
/**
 * Regenerates `packages/core/src/panel-body.allowlist.ts` from the live tree.
 *
 * Run it after converting widgets from a `Panel` body to `Panel sections`, so
 * the debt list keeps telling the truth about what is left:
 *
 *   node scripts/panel-body-debt.mjs --update
 *
 * Without `--update` it only prints the census, which is the safe thing to run
 * when you want to know where you stand.
 *
 * It reads the SAME scan the gate reads, by transpiling `panel-body.scan.ts`
 * rather than re-implementing the matcher. A generator with its own copy of the
 * rule drifts from the gate, and then the list it writes is the list the gate
 * rejects.
 *
 * The gate refuses a debt list that GREW, so a bare `--update` cannot launder a
 * new body into the tree: the shrink-only check compares against the ratchet
 * base ref and fails on any added or raised entry.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const scanPath = join(root, "packages/core/src/panel-body.scan.ts");
const rootsPath = join(root, "packages/core/src/styleguideScanRoots.ts");
const outPath = join(root, "packages/core/src/panel-body.allowlist.ts");

// esbuild is a dependency of `packages/core`, not of the workspace root, so it
// resolves from the scan's own directory rather than from this script's.
const { transformSync } = createRequire(scanPath)("esbuild");

function load(path, required) {
  const js = transformSync(readFileSync(path, "utf8"), {
    loader: "ts",
    format: "cjs",
  }).code;
  const module_ = { exports: {} };
  new Function("module", "exports", "require", js)(
    module_,
    module_.exports,
    required,
  );
  return module_.exports;
}

const roots = load(rootsPath, createRequire(rootsPath));
const scan = load(scanPath, (id) =>
  id === "./styleguideScanRoots" ? roots : createRequire(scanPath)(id),
);

/**
 * The floors already committed, so a regeneration can only ever raise them.
 * Zeroes when the allowlist does not exist yet, which is the seeding run.
 */
function readPreviousFloors(path) {
  const empty = { files: 0, tags: 0 };
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return empty;
  }
  const read = (key) => {
    const found = source.match(new RegExp(`${key}:\\s*(\\d+)`));
    return found ? Number(found[1]) : 0;
  };
  return { files: read("files"), tags: read("tags") };
}

const result = scan.scanPanelBodies();
const total = [...result.counts.values()].reduce((a, b) => a + b, 0);
console.info(
  `scanned ${result.scanned} widget-side .tsx files (${result.skipped} tests/generated skipped), ` +
    `${result.counts.size} still pass a Panel body, ${total} bodies`,
);

if (!process.argv.includes("--update")) {
  const worst = [...result.counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  console.info("\nmost bodies:");
  for (const [file, n] of worst) {
    console.info(`  ${String(n).padStart(3)}  ${file}`);
  }
  console.info("\nRe-run with --update to write the allowlist.");
  process.exit(0);
}

const entries = [...result.counts.entries()].sort(([a], [b]) =>
  a < b ? -1 : 1,
);

/*
 * Floors sit well below the seeded census so ordinary churn never touches them
 * and only a broken enumeration does.
 *
 * NEITHER counts the debt, and that is the whole design. This list has a real
 * zero to aim at, so a floor under the debt population would be a floor the work
 * is trying to walk through: clearing the last widgets would trip the instrument
 * check, and the shrink-only guard refuses to lower a floor, so finishing would
 * mean fighting the gate. `tags` counts every `<Panel>` INCLUDING the converted
 * self-closing ones, so it holds steady while the debt falls.
 */
const previous = readPreviousFloors(outPath);
const floors = {
  files: Math.max(Math.floor(result.scanned * 0.5), previous.files),
  tags: Math.max(Math.floor(result.tags * 0.5), previous.tags),
};

const header = `/**
 * Widget files that still give their \`Panel\` a body (children) instead of
 * \`sections\`, with how many such panels each has.
 *
 * SHRINK-ONLY. Entries may be lowered or removed, never added or raised. A new
 * entry means new code just wrote a body, which is the thing the gate exists to
 * stop; pass \`sections\` instead.
 *
 * Unlike most debt lists in this repo, THIS ONE HAS A REAL ZERO TO AIM AT. Every
 * entry here is a widget that can be converted, and the conversion is mechanical:
 * wrap each group in a \`Section\` with its \`title\`, hand the list to
 * \`sections\`, close the tag. What the widget gets back is Panel deciding how
 * those sections flow, so a landscape tile runs them in columns instead of
 * wasting its width on one.
 *
 * Regenerate after a conversion with:
 *
 *   node scripts/panel-body-debt.mjs --update
 *
 * See \`styleguide-panel-body.test.ts\` for what counts and \`panel-body.scan.ts\`
 * for the matcher itself.
 */
export const PANEL_BODY_DEBT: Record<string, number> = {
`;

const body = entries
  .map(([file, n]) => `  ${JSON.stringify(file)}: ${n},`)
  .join("\n");

const footer = `
};

/**
 * The instrument check. Every other assertion in the gate is
 * \`expect(offenders).toEqual([])\`, and a scan that walks zero files satisfies
 * all of them: a wrong cwd, a scan root that no longer exists or a
 * \`git ls-files\` that errored into an empty string each look exactly like a
 * clean repo.
 *
 * Neither number counts the DEBT, on purpose. This list has a real zero to aim
 * at, and a floor under the debt population would be one the work has to walk
 * through: the shrink-only guard refuses to lower a floor, so clearing the last
 * widgets would have meant fighting the gate. \`tags\` counts every \`<Panel>\`
 * opening tag, the converted self-closing ones included, so it holds steady
 * while the debt falls and still fails if the walk stops finding panels.
 */
export const SCAN_FLOORS = {
  files: ${floors.files},
  tags: ${floors.tags},
} as const;
`;

writeFileSync(outPath, header + body + footer);
console.info(`\nwrote ${outPath}`);
console.info(
  `floors: ${floors.files} files scanned, ${floors.tags} Panel tags`,
);
