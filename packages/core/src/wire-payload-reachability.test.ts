// @vitest-environment node
//
// Node realm rather than the package's jsdom default: this walks the mod tree and touches no DOM.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Can every type that reaches the Sitrep wire actually be WRITTEN?
 *
 * `JsonWriter.AppendValue` dispatches on runtime type and throws for anything it
 * has no case for; `EnvelopeCodec` catches the throw and fail-softs, so the
 * frame is dropped and the client sits on "subscribed" with nothing red
 * anywhere. It has now happened five times, and the fourth
 * (`commandCentre.roster`) took a live save with real command centres in it to
 * see, because an EMPTY collection serialises perfectly and every headless rig
 * publishes one.
 *
 * ## Why this is here and not only in C#
 *
 * `mod/Sitrep.Core.Tests/WirePayloadCoverageTests.cs` asks the same question by
 * reflection and missed two of the five, because both sat on its
 * `FlattenedByProducer` allowlist. An entry there is a human CLAIM about what a
 * producer does, and reflection cannot grade a claim: the roster's entry was
 * recorded as hand-flattened when nothing flattens it, and `RepairOutcome` as
 * riding out inside a flattened reply when `CommandResult<T>.Payload` goes
 * straight back through `AppendValue`. Both claims were also written into the
 * contract's own doc comments, which is how one false premise ends up
 * corroborating itself.
 *
 * So this reads a different inventory and derives its verdicts instead of
 * accepting them. The inventory is the generated channel map, walked
 * transitively through the contract's field types; the verdicts come off the
 * mod sources. There is no allowlist here to put a claim in.
 *
 * ## Living in core's scan suite
 *
 * It reads the whole mod tree, so it needs the cache key that covers it. Same
 * reasoning as `asyncapi-document.test.ts` beside it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

interface Verdict {
  name: string;
  via: string;
  root: boolean;
  verdict: "written" | "never-built" | "producer-flattened" | "uncovered";
  detail: string;
}

interface Report {
  roots: number;
  reached: number;
  writable: number;
  files: number;
  verdicts: Verdict[];
  uncovered: Verdict[];
  selfCheckProblems: string[];
}

interface Gate {
  checkWirePayloadCoverage: (root?: string) => Report;
  scanCSharp: (files: { path: string; text: string }[]) => {
    constructed: Map<string, string>;
    flattened: Map<string, string>;
  };
  writableTypes: (source: string) => {
    switched: Set<string>;
    helpers: Set<string>;
  };
  classify: (
    name: string,
    input: {
      writable: { switched: Set<string>; helpers: Set<string> };
      constructed: Map<string, string>;
      flattened: Map<string, string>;
      root: boolean;
    },
  ) => { verdict: string; detail: string };
  productionSources: (root?: string) => { path: string; text: string }[];
}

/**
 * The gate, loaded by URL.
 *
 * A non-literal specifier so the `.mjs` needs no declaration file, the same way
 * `asyncapi-document.test.ts` loads its generator: a `.d.ts` restating these
 * exports would be a second copy of a signature, free to go stale.
 *
 * Annotated on the way in rather than asserted on the way out. The two type the
 * same thing; only the assertion form spends against the `unknown-cast` ratchet,
 * whose whole subject is leaving a boundary type by assertion.
 */
async function loadGate(): Promise<Gate> {
  const url = pathToFileURL(
    join(REPO_ROOT, "scripts/wire-payload-coverage.mjs"),
  ).href;
  const loaded: Gate = await import(url);
  return loaded;
}

describe("wire payload reachability", () => {
  let gate: Gate;
  let report: Report;

  beforeAll(async () => {
    gate = await loadGate();
    report = gate.checkWirePayloadCoverage(REPO_ROOT);
  }, 120_000);

  it("can see a planted violation of every arm", () => {
    // The scan is regex over C#, and a regex that stops matching reports zero,
    // which reads exactly like a clean tree. The gate plants one of each verdict
    // through its own `scanCSharp` and `classify` on every run, so a pattern that
    // has gone quiet fails here as BLIND rather than passing.
    expect(report.selfCheckProblems).toEqual([]);
  });

  it("reaches the contract, the writer and the mod sources", () => {
    // Three separate collapses, each of which would make the sweep report a
    // clean tree over nothing. Floors well under the current values (125 / 167 /
    // 41 / 594 at the time of writing), so they catch a collapse and not growth.
    expect(report.roots).toBeGreaterThan(100);
    expect(report.reached).toBeGreaterThan(120);
    expect(report.writable).toBeGreaterThan(30);
    expect(report.files).toBeGreaterThan(400);
  });

  it("counts a producer file that is not committed yet", () => {
    // The scan lists sources through git, and `git ls-files` alone reads the
    // INDEX: a producer added in the working tree and never staged is invisible
    // to it, so the gate reads green over the very file introducing the bug.
    // That is not hypothetical, it is what the planted violation that validated
    // this gate did on its first run.
    const listed = gate.productionSources(REPO_ROOT).map((file) => file.path);
    const untracked = execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "mod"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter((path) => path.endsWith(".cs"));
    for (const path of untracked) expect(listed).toContain(path);
  });

  it("does not accept a nested helper as coverage for a channel root", () => {
    // A hand-written `Append<Type>` helper covers a value a SIBLING flattener
    // writes directly. It does nothing for a value handed to `AppendValue`,
    // which is what a channel payload always is. Conflating the two left this
    // gate green with the roster's `case` deleted and its helper still in place,
    // so the distinction is pinned rather than left to the reader.
    const writable = gate.writableTypes(
      "private static void AppendHelperOnly(StringBuilder sb, Sitrep.Contract.HelperOnly h)\n",
    );
    const scanned = gate.scanCSharp([
      { path: "planted.cs", text: "var x = new HelperOnly();" },
    ]);
    const input = {
      writable,
      constructed: scanned.constructed,
      flattened: scanned.flattened,
    };
    expect(gate.classify("HelperOnly", { ...input, root: false }).verdict).toBe(
      "written",
    );
    expect(gate.classify("HelperOnly", { ...input, root: true }).verdict).toBe(
      "uncovered",
    );
  });

  it("has no payload type a producer builds that nothing can write", () => {
    const named = report.uncovered.map(
      (entry) =>
        `${entry.name} (published on ${entry.via}, built in ${entry.detail})`,
    );
    expect(
      named,
      "These types reach the wire as raw POCOs with no JsonWriter case, so every " +
        "populated payload carrying one is dropped at the wire boundary and the " +
        "client sees nothing. Add a case plus an Append<Type> helper (mirror " +
        "AppendCommsDelay), or flatten the value in its producer through a NAMED " +
        "method that takes the type and returns Dictionary<string, object?>.",
    ).toEqual([]);
  });
});
