/**
 * Folds a review-sheet export into the review ledger, the later export
 * winning per item:
 *
 *   pnpm --filter @ksp-gonogo/storybook review-ledger import <export.json> [--ledger <path>]
 *
 * An export from a sheet that carried no fingerprints also needs
 * `--tree <dir>`: a checkout of the export's `sourceSha` with the stories
 * generated in it, which the fingerprints are then taken from.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Fingerprinter } from "./fingerprint";
import type { TargetKind } from "./generate-stories";
import {
  fold,
  ledgerPath,
  readExport,
  readLedger,
  writeLedger,
} from "./ledger";

const TARGETS = "packages/storybook/dist/stories/review-targets.json";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

/** Where a path given on the command line is relative to, under `pnpm --filter` too. */
function fromCaller(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

function git(tree: string, ...args: string[]): string {
  return execFileSync("git", ["-C", tree, ...args])
    .toString()
    .trim();
}

/** Fingerprints taken in `tree`, which must be a clean checkout of `sha` with its stories generated. */
function fingerprintsIn(tree: string, sha: string) {
  const head = git(tree, "rev-parse", "HEAD");
  if (head !== sha) {
    throw new Error(`${tree} is at ${head}, the export is from ${sha}`);
  }
  if (git(tree, "status", "--porcelain", "--untracked-files=no") !== "") {
    throw new Error(`${tree} has uncommitted changes`);
  }
  const targetsFile = join(tree, TARGETS);
  if (!existsSync(targetsFile)) {
    throw new Error(
      `${targetsFile} is missing: run \`pnpm --filter @ksp-gonogo/storybook generate\` in ${tree}`,
    );
  }
  const targets: Record<TargetKind, Record<string, string[]>> = JSON.parse(
    readFileSync(targetsFile, "utf8"),
  );
  const fingerprinter = new Fingerprinter(tree);
  const faults: string[] = [];
  const of = (item: { kind: TargetKind; id: string }): string | null => {
    const result = fingerprinter.fingerprint({
      ...item,
      stories: targets[item.kind]?.[item.id] ?? [],
    });
    if ("hash" in result) return result.hash;
    faults.push(result.fault);
    return null;
  };
  return { of, faults };
}

function main(): void {
  const argv = process.argv.slice(2);
  const [command, path] = argv;
  if (command !== "import" || !path || path.startsWith("--")) {
    throw new Error(
      "usage: review-ledger import <export.json> [--tree <dir>] [--ledger <path>]",
    );
  }
  const file = fromCaller(path);
  const sheet = readExport(file);
  const unprinted = sheet.items.filter((i) => i.fingerprint === undefined);
  const treeFlag = flag(argv, "--tree");
  if (unprinted.length > 0 && !treeFlag) {
    throw new Error(
      `${unprinted.length} item(s) in ${file} carry no fingerprint: pass --tree <checkout of ${sheet.sourceSha}>`,
    );
  }
  const taken = treeFlag
    ? fingerprintsIn(fromCaller(treeFlag), sheet.sourceSha)
    : undefined;
  const target = ledgerPath(argv);
  const ledger = readLedger(target);
  const folded = fold(ledger, sheet, (item) => taken?.of(item) ?? null);
  writeLedger(ledger, target);
  for (const fault of taken?.faults ?? []) {
    console.warn(`review-ledger: no fingerprint, stays unapproved: ${fault}`);
  }
  const approved = sheet.items.filter((i) => i.approved).length;
  console.log(
    `review-ledger: ${folded.written} item(s) written (${approved} approved in the export), ${folded.older} left as a later export had them`,
  );
  console.log(`review-ledger: ${target}`);
}

main();
