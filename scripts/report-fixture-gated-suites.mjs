#!/usr/bin/env node
/**
 * Prints which suites did not run, and why, as a line in the job log.
 *
 * Three suites are gated on `local_docs/telemetry-mod/recordings/
 * reference-wire-fixture.json`, which `local_docs/` being blanket-gitignored
 * means CI can never have. They skip cleanly, which is correct, and a skipped
 * suite is indistinguishable in a reporter from a suite that was meant to
 * skip. `pnpm test` says "passed" in both cases, so the fact that a whole
 * recorded-wire coverage tier did not execute has never appeared anywhere a
 * person reads.
 *
 * This is that place. It exits 0 whatever it finds: a missing fixture is the
 * normal state in CI and a permanently red step hides the next real failure
 * behind it, which is what this repo already lives with on `visual`. What it
 * refuses to do is stay quiet.
 *
 * The register it reads (`packages/core/src/fixture-gated-suites.ts`) is held
 * to the tree by `fixture-gated-suites.test.ts`, so this cannot print a stale
 * list without that going red first.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const REGISTER = join(ROOT, "packages/core/src/fixture-gated-suites.ts");

/**
 * Read as text rather than imported: this runs before any build, and the
 * register is a TypeScript source file that node cannot load directly. The
 * shape being read is a flat array of string literals per field.
 */
function readRegister() {
  const source = readFileSync(REGISTER, "utf8");
  const body = source.slice(source.indexOf("FIXTURE_GATED_SUITES"));
  const entries = [];
  for (const block of body.split("  {").slice(1)) {
    const file = /file:\s*\n?\s*"([^"]+)"/.exec(block)?.[1];
    const fixture = /fixture:\s*\n?\s*"([^"]+)"/.exec(block)?.[1];
    const tests = /tests:\s*(\d+)/.exec(block)?.[1];
    const covers = /covers:\s*\n?\s*"((?:[^"\\]|\\.)*)"/.exec(block)?.[1];
    if (file && fixture && tests) {
      entries.push({ file, fixture, tests: Number(tests), covers });
    }
  }
  return entries;
}

const suites = readRegister();
if (suites.length === 0) {
  // Not a pass. A reader who sees nothing concludes there is nothing to see,
  // which is the exact failure this script exists to end.
  console.error(
    "[fixture-gated] could not read any entry from packages/core/src/fixture-gated-suites.ts. " +
      "The register moved or changed shape; this reporter is printing nothing " +
      "and nothing reads as 'everything ran'.",
  );
  process.exit(1);
}

const fixtures = new Map();
for (const suite of suites) {
  if (!fixtures.has(suite.fixture)) {
    fixtures.set(suite.fixture, existsSync(join(ROOT, suite.fixture)));
  }
}

const notRunning = suites.filter((s) => !fixtures.get(s.fixture));
const lostTests = notRunning.reduce((sum, s) => sum + s.tests, 0);

console.log("");
console.log("── Fixture-gated suites ─────────────────────────────────────");
for (const suite of suites) {
  const present = fixtures.get(suite.fixture);
  console.log(
    `${present ? "RAN     " : "NOT RUN "} ${suite.file}  (${suite.tests} test${
      suite.tests === 1 ? "" : "s"
    })`,
  );
  if (!present) {
    console.log(`         needs   ${suite.fixture}`);
    console.log(`         loses   ${suite.covers}`);
  }
}
console.log("");
if (notRunning.length === 0) {
  console.log(
    `All ${suites.length} fixture-gated suites ran: every fixture is present.`,
  );
} else {
  console.log(
    `${notRunning.length} of ${suites.length} suites did not run, ${lostTests} test(s) skipped, ` +
      "because their fixture is absent. In CI that is expected and permanent: " +
      "the fixture is generated from a captured KSP session into local_docs/, " +
      "which is gitignored. Locally, regenerate with `dotnet test --filter " +
      "WireFixtureGeneratorTests` in `mod/` once the recording is in place.",
  );
}
console.log("─────────────────────────────────────────────────────────────");
console.log("");
