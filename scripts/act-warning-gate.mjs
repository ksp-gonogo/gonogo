/**
 * `act()` warning ratchet: counts every React act warning the test tree emits and
 * fails when any file's count moves away from `act-warning-debt.mjs`.
 *
 * ## Why this is a script and not a vitest test
 *
 * It has to RUN the suites in order to read what they print, so it cannot live
 * inside one of them. It also cannot ride on `pnpm test`, because the thing it
 * measures is invisible from there.
 *
 * ## The reporter, which is the whole reason a hundred warnings went unnoticed
 *
 * Vitest 4's default reporter suppresses console output for tests that PASS, and an
 * act warning does not fail the test that emits it. So `pnpm test` prints none of
 * them, on any run, and always has. `--reporter=verbose` prints them, prefixed with
 * a `stderr | <file> > <test name>` header, which is where the per-file attribution
 * below comes from at no extra cost.
 *
 * `--silent=false` is NOT the flag. It looks like the right one and changes nothing
 * here, which is the trap worth knowing about before someone "checks" and reports a
 * clean tree.
 *
 * ## The self-test, which runs first and is not optional
 *
 * A counter that cannot see a warning reports zero, and zero reads as success. That
 * is precisely the state this tree was in until the census, so the gate proves its
 * own instrument on every run before it believes any number: it plants a component
 * that updates outside `act()`, runs that one file, and requires the count to rise.
 * If it does not, the run fails as BLIND rather than reporting a green tree, because
 * a vitest upgrade that changes reporter behaviour would otherwise turn this whole
 * gate into a permanently passing no-op and nothing would say so.
 *
 * ## The debt is a ceiling, and the count is noisy
 *
 * Several of these come from cleanup-ordering and handshake races, so whether one
 * fires is timing-dependent: five full runs of an UNCHANGED tree gave 104, 100, 104,
 * 124 and 103, and one file alone ranged 0 to 21. The gate therefore fails on growth
 * and on new files, re-measuring first so a spuriously high reading cannot fail an
 * innocent branch, and merely reports a count that came in low. Tightening after a
 * real fix is a deliberate `--update`.
 *
 * Load matters in the direction people do not expect: contention does not hide a
 * race, it gives it more chances to fire. So a count taken on a loaded box is the
 * MAXIMUM, a low count on a quiet one is not evidence of absence, and the worst
 * reading is the truest. That is why `--update` never lowers a COMMENTED entry: a
 * comment marks a number that was chosen rather than measured.
 *
 * ## A failing suite is an undercount, not a pass
 *
 * If a package's vitest exits non-zero the gate fails too. A suite that crashed part
 * way through emits fewer warnings than the tree really has, and reporting that as
 * "shrunk" would be the same false green from a different direction.
 *
 * Usage:
 *   pnpm act-warning-gate              check against the committed debt
 *   pnpm act-warning-gate --update     rewrite the debt from what is measured now
 *   pnpm act-warning-gate --filter ui  restrict to packages matching a substring
 *   pnpm act-warning-gate --update --only <substring>
 *                                      rewrite ONLY entries matching <substring>
 *
 * `--only` exists because a plain `--update` is a force-push for baselines: it rewrites
 * the whole tree from one fresh measurement, so a commit about one widget's fix also
 * writes down that run's roll for every noisy entry it never touched. Fixing four files
 * should move four numbers.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_ACT_WARNINGS } from "./act-warning-debt.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const update = args.includes("--update");
const filterIdx = args.indexOf("--filter");
const filter = filterIdx >= 0 ? args[filterIdx + 1] : null;
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

/**
 * Both React 18 spellings. The second only appears when `act()` is called without
 * the environment flag, which is a different bug from an un-wrapped update but is
 * equally ours and equally invisible from `pnpm test`.
 */
const WARNING =
  /not wrapped in act|testing environment is not configured to support act/i;
const STDERR_HEADER = /^stderr \| (\S+)/;
/**
 * Vitest's per-test failure line, so a crashed suite can name what broke.
 *
 * Matched against the line with its colour codes removed. Vitest paints the
 * package name as a background badge, and the `|components|` pipes a terminal
 * shows are the codes themselves: matching them found nothing in CI, where the
 * gate reads a pipe rather than a tty.
 */
// Built from a char code rather than written as an escape: an ESC in a regex
// literal is a lint error, and the codes are what has to be matched.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const FAILED_TEST = /^\s*FAIL\s/;
const SELF_TEST_FILE = "ZzActGateSelfTest.test.tsx";

/** The package the self-test is planted in: small, first-party, and it renders React. */
const SELF_TEST_PACKAGE = "@ksp-gonogo/ui";
const SELF_TEST_DIR = "packages/ui";
const SELF_TEST_RENDER_IMPORT = "@ksp-gonogo/test-utils";

const SELF_TEST_SOURCE = `// Generated by scripts/act-warning-gate.mjs and deleted again in the same run.
// If you are reading this in a committed diff, the gate crashed mid-run: delete it.
import { render, screen } from "${SELF_TEST_RENDER_IMPORT}";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";

let bump = null;

function ActGateSelfTest() {
  const [n, setN] = useState(0);
  useEffect(() => {
    bump = () => setN((v) => v + 1);
  }, []);
  return <span>count {n}</span>;
}

describe("act-warning-gate self test", () => {
  it("updates outside act on purpose, so the gate can prove it still sees one", async () => {
    render(<ActGateSelfTest />);
    expect(screen.getByText(/count 0/)).toBeTruthy();
    bump?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText(/count 1/)).toBeTruthy();
  });
});
`;

/**
 * Machine load beside the count, because these two are the same measurement taken in
 * different conditions and the difference is not small: the tree total has ranged 100
 * to 124 unchanged, and one file 0 to 21. A reader comparing today's number with next
 * week's needs to know which they are holding, and which way to read a drop. Recorded
 * rather than acted on, since the gate is a ceiling and survives the noise either way.
 */
function loadLine() {
  const cores = cpus().length;
  const [one, five, fifteen] = loadavg().map((n) => n.toFixed(2));
  return `measured at load ${one} / ${five} / ${fifteen} on ${cores} cores`;
}

function packagesWithTests() {
  const found = [];
  const roots = [
    ...readdirSync(join(repoRoot, "packages")).map((d) => join("packages", d)),
    ...readdirSync(join(repoRoot, "mod")).flatMap((d) => [
      join("mod", d),
      join("mod", d, "client"),
    ]),
  ];
  for (const dir of roots) {
    let manifest;
    try {
      manifest = JSON.parse(
        readFileSync(join(repoRoot, dir, "package.json"), "utf8"),
      );
    } catch {
      continue;
    }
    if (!manifest.scripts?.test) continue;
    found.push({
      name: manifest.name,
      short: manifest.name.replace("@ksp-gonogo/", ""),
      dir,
    });
  }
  return found.sort((a, b) => a.short.localeCompare(b.short));
}

/**
 * Run one package's vitest and return `{ counts, failed, failures }`, where
 * `counts` is keyed by the file path vitest itself reports, already relative to
 * the package root, and `failures` names the tests that failed.
 *
 * `failures` exists because "(SUITE FAILED)" on its own sends the reader to
 * `pnpm test`, which runs the packages in parallel and so is SLOWER per package
 * than this gate's one-at-a-time walk. A rate budget breaches when the machine
 * is fast, so the suite this gate crashed on passed there and the job read as
 * unreproducible.
 */
function measure(pkg, onlyFile) {
  const argv = ["--filter", pkg.name, "exec", "vitest", "run"];
  if (onlyFile) argv.push(onlyFile);
  argv.push("--reporter=verbose");

  // spawnSync rather than execFileSync, and BOTH streams. Vitest prints the
  // warnings on stderr, and execFileSync returns only stdout when the command
  // succeeds, so reading its return value silently dropped every warning from any
  // suite that passed, which is all of them. The self-test caught that on the first
  // run, which is the entire argument for having one.
  const run = spawnSync("pnpm", argv, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const failed = run.status !== 0;

  const counts = {};
  const failures = [];
  let current = null;
  for (const line of output.split("\n")) {
    const plain = line.replace(ANSI, "");
    if (FAILED_TEST.test(plain)) failures.push(plain.trim());
    const header = STDERR_HEADER.exec(line);
    if (header) {
      current = header[1];
      continue;
    }
    if (!WARNING.test(line) || !current) continue;
    if (current.includes(SELF_TEST_FILE)) continue;
    counts[current] = (counts[current] ?? 0) + 1;
  }
  return { counts, failed, failures };
}

function runSelfTest() {
  const path = join(repoRoot, SELF_TEST_DIR, "src", SELF_TEST_FILE);
  writeFileSync(path, SELF_TEST_SOURCE);
  try {
    const argv = [
      "--filter",
      SELF_TEST_PACKAGE,
      "exec",
      "vitest",
      "run",
      `src/${SELF_TEST_FILE}`,
      "--reporter=verbose",
    ];
    const run = spawnSync("pnpm", argv, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    return output.split("\n").filter((l) => WARNING.test(l)).length;
  } finally {
    rmSync(path, { force: true });
  }
}

function writeDebt(rawMeasured) {
  const source = readFileSync(
    join(repoRoot, "scripts/act-warning-debt.mjs"),
    "utf8",
  );

  // Per-entry comments are carried across. Some entries need a note that outlives
  // any single measurement (the intermittent one, most obviously, whose whole
  // explanation is why its count is not stable), and regenerating the block from the
  // numbers alone would delete exactly the annotation that stops the next reader
  // treating it as a plain regression.
  const notes = {};
  let pending = [];
  for (const line of source.split("\n")) {
    const comment = /^\s*\/\/(.*)$/.exec(line);
    if (comment) {
      pending.push(`  //${comment[1]}`);
      continue;
    }
    const entry = /^\s*"([^"]+)":\s*\d+,/.exec(line);
    if (entry && pending.length > 0) notes[entry[1]] = pending;
    pending = [];
  }

  // A COMMENTED entry is never lowered by --update. The comment is the marker for
  // "this number was chosen rather than measured", which is exactly the case a
  // regenerate must not silently overwrite: the one annotated entry here is seeded at
  // the worst reading across 0/1/21, and a quiet run would replace it with today's
  // roll and carry the explanation along to the new number, leaving the file asserting
  // a maximum it no longer holds.
  //
  // Reversing my own note in the debt file, which argued against reading intent out of
  // comments. That holds for INFERRING a value; refusing to lower one fails closed, so
  // the worst case is slack that a later deliberate edit removes rather than a ceiling
  // that vanishes unnoticed. One mechanism beats a hand-maintained second list.
  const measured = { ...rawMeasured };
  for (const [file, note] of Object.entries(notes)) {
    const known = KNOWN_ACT_WARNINGS[file];
    if (known === undefined || note.length === 0) continue;
    const now = measured[file] ?? 0;
    if (now < known) {
      measured[file] = known;
      console.log(
        `  keeping ${file} at ${known} (measured ${now}); it carries a comment, so the ` +
          `number was chosen. Edit it by hand if you actually fixed it.`,
      );
    }
  }

  const entries = Object.entries(measured)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .flatMap(([file, n]) => [
      ...(notes[file] ?? []),
      `  ${JSON.stringify(file)}: ${n},`,
    ])
    .join("\n");
  const block = /export const KNOWN_ACT_WARNINGS = \{[\s\S]*?\n\};/;
  // Say so rather than writing the file back unchanged. Now that the debt is
  // empty the block can end up as a one-line `{};`, which this pattern does not
  // match, and a silent no-op here would report "debt rewritten" over a file it
  // never touched.
  if (!block.test(source)) {
    throw new Error(
      "Could not find the KNOWN_ACT_WARNINGS block in act-warning-debt.mjs. It has " +
        "to span at least one line (`{\\n…\\n};`); a collapsed `{}` does not match. " +
        "Put a line inside it and re-run.",
    );
  }
  const next = source.replace(
    block,
    `export const KNOWN_ACT_WARNINGS = {\n${entries}\n};`,
  );
  writeFileSync(join(repoRoot, "scripts/act-warning-debt.mjs"), next);
}

const packages = packagesWithTests().filter(
  (p) => !filter || p.short.includes(filter),
);

/*
 * The self-test below proves the COUNTER can see a warning. It cannot prove the
 * gate is measuring anything: `packagesWithTests` skips a directory whose
 * manifest will not parse, and a `--filter` that matches nothing leaves this
 * empty, at which point `inScope()` excludes every file and the gate reports a
 * tree that matches its debt exactly.
 */
if (packages.length === 0) {
  console.error(
    filter
      ? `\n✖ --filter ${filter} matched no package with a test script, so nothing was measured.`
      : "\n✖ BLIND: found no package with a test script, so nothing was measured.",
  );
  process.exit(1);
}

console.log("act-warning-gate: proving the instrument before trusting it");
const selfTestCount = runSelfTest();
if (selfTestCount < 1) {
  console.error(
    `\nBLIND: the self-test planted a component that updates outside act() in ` +
      `${SELF_TEST_DIR} and the gate counted ${selfTestCount} warnings.\n` +
      `The counter cannot see a warning, so every number it reports is meaningless ` +
      `and a green run would be a lie.\n` +
      `Most likely a vitest reporter change: confirm by hand with\n` +
      `  pnpm --filter ${SELF_TEST_PACKAGE} exec vitest run <a react test> --reporter=verbose\n` +
      `and check whether console output appears at all.`,
  );
  process.exit(1);
}
console.log(
  `act-warning-gate: self-test emitted ${selfTestCount}, the counter can see one\n`,
);

const measured = {};
const crashed = [];
for (const pkg of packages) {
  const { counts, failed, failures } = measure(pkg);
  if (failed) crashed.push({ short: pkg.short, failures });
  let total = 0;
  for (const [file, n] of Object.entries(counts)) {
    measured[`${pkg.short}/${file}`] = n;
    total += n;
  }
  console.log(
    `  ${pkg.short.padEnd(32)} ${String(total).padStart(4)}${failed ? "  (SUITE FAILED)" : ""}`,
  );
  for (const failure of failures) console.log(`    ${failure}`);
}

const total = Object.values(measured).reduce((a, b) => a + b, 0);
console.log(
  `\ntotal: ${total} act warnings across ${Object.keys(measured).length} files` +
    `\n${loadLine()}\n`,
);

if (update) {
  if (filter && !only) {
    console.error(
      "Refusing to --update under --filter. The debt is the whole tree, and rewriting " +
        "it from one package's measurement would delete every entry that was never run, " +
        "reporting the rest of the tree as fixed. Either drop --filter, or add --only " +
        "<substring> to say which entries you actually mean to rewrite.",
    );
    process.exit(1);
  }
  if (only) {
    // Every committed entry survives untouched except the ones named, which take what
    // was just measured, and are dropped when that is now zero.
    const merged = { ...KNOWN_ACT_WARNINGS };
    const touched = new Set();
    for (const file of Object.keys(merged)) {
      if (file.includes(only)) {
        delete merged[file];
        touched.add(file);
      }
    }
    for (const [file, n] of Object.entries(measured)) {
      if (file.includes(only)) {
        merged[file] = n;
        touched.add(file);
      }
    }
    if (touched.size === 0) {
      console.error(
        `No debt entry and no measured file matches --only ${only}.`,
      );
      process.exit(1);
    }
    console.log(`Rewriting only: ${[...touched].join(", ")}`);
    writeDebt(merged);
  } else {
    writeDebt(measured);
  }
  console.log(
    "act-warning-debt.mjs rewritten. Commit it with whatever you fixed.",
  );
  process.exit(0);
}

if (crashed.length > 0) {
  console.error(
    `A suite failed in: ${crashed.map((c) => c.short).join(", ")}.\n` +
      `A crashed suite emits fewer warnings than the tree really has, so this count is ` +
      `an undercount and cannot be compared against the debt. Fix the suite first.`,
  );
  process.exit(1);
}

// Only the packages actually measured are compared. Under `--filter` the rest were
// never run, and reading their absence as "fixed" would report the whole tree green
// from one package's suite.
const measuredPackages = new Set(packages.map((p) => p.short));
const inScope = (file) => measuredPackages.has(file.split("/")[0]);

function compare(counts) {
  const out = [];
  for (const [file, n] of Object.entries(counts)) {
    const known = KNOWN_ACT_WARNINGS[file];
    if (known === undefined) out.push(`NEW    ${file}: ${n}`);
    else if (n > known) out.push(`WORSE  ${file}: ${known} -> ${n}`);
  }
  for (const [file, known] of Object.entries(KNOWN_ACT_WARNINGS)) {
    if (!inScope(file)) continue;
    const n = counts[file] ?? 0;
    if (n < known) out.push(`BETTER ${file}: ${known} -> ${n}`);
  }
  return out;
}

let problems = compare(measured);

if (problems.length === 0) {
  console.log("act-warning-gate: clean, every file matches the debt exactly.");
  process.exit(0);
}

// Some of these warnings are genuinely intermittent: `Navball/index.test.tsx` emits
// one on roughly a third of runs, from a race rather than from anything the suite
// changed. A gate that failed on a single reading would therefore go red on its own
// schedule, and a gate that cries wolf gets disabled, which costs more than the
// warnings do. So a discrepancy has to REPRODUCE: re-measure only the packages
// involved and keep only what survives.
//
// Confirmation runs on both sides deliberately. A spuriously HIGH reading would
// otherwise fail an innocent branch, and a spuriously LOW one would demand a debt
// update that then bounces back.
const suspectPackages = new Set(
  problems.map((p) => p.split(/\s+/)[1].split("/")[0]),
);
console.error(
  `Discrepancy in ${[...suspectPackages].join(", ")}; re-measuring to see whether it reproduces.\n`,
);
const confirmed = { ...measured };
for (const pkg of packages.filter((p) => suspectPackages.has(p.short))) {
  const { counts } = measure(pkg);
  for (const key of Object.keys(confirmed)) {
    if (key.startsWith(`${pkg.short}/`)) delete confirmed[key];
  }
  for (const [file, n] of Object.entries(counts))
    confirmed[`${pkg.short}/${file}`] = n;
}

const second = new Set(compare(confirmed));
const vanished = problems.filter((p) => !second.has(p));
problems = problems.filter((p) => second.has(p));

if (vanished.length > 0) {
  console.error(
    `Not reproduced on the second run, so not failed on:\n${vanished.map((v) => `  ${v}`).join("\n")}\n`,
  );
}

// The debt is a CEILING, not an equality, and that is a measured decision rather than
// a softer rule.
//
// Several of these warnings come from cleanup-ordering and handshake races, so whether
// one fires is genuinely timing-dependent: three consecutive full runs of an unchanged
// tree gave 104, 100 and 104, with `SettingsModal` swinging 3 to 0 and
// `Navball/index` 1 to 0. A gate that failed on any downward move would therefore go
// red on its own schedule on an untouched branch, and a gate that cries wolf gets
// disabled, which costs more than the warnings do.
//
// So a file emitting FEWER than its entry is reported and not failed on. The ratchet
// still does the job it exists for, which is that nothing grows and nothing new
// appears; tightening the numbers after a real fix is a deliberate `--update` in the
// same commit, and the reminder below is what prompts it.
const better = problems.filter((p) => p.startsWith("BETTER"));
problems = problems.filter((p) => !p.startsWith("BETTER"));

if (better.length > 0) {
  console.log(
    `Below the recorded count, twice:\n${better.map((b) => `  ${b}`).join("\n")}\n` +
      `If you fixed these, run \`pnpm act-warning-gate --update\` and commit the debt ` +
      `with the fix.\nIf you did not, they are intermittent and the entry stays at the ` +
      `count it reaches when it fires.\n`,
  );
}

if (problems.length === 0) {
  console.log("act-warning-gate: clean, nothing new and nothing grown.");
  process.exit(0);
}

console.error(`${problems.join("\n")}\n`);
console.error(
  "An act warning is always our bug (CLAUDE.md, Testing Philosophy). A new or grown " +
    "entry means a test started updating React outside act(), and it reproduced on a " +
    "second measurement so it is not the intermittency described above.",
);
process.exit(1);
