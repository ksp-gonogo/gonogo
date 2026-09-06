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
 * accepting them. The inventory is the generated channel map of EVERY generated
 * slice, the core contract and each Uplink's own, walked transitively through
 * the contract's field types; the verdicts come off the mod sources. There is no
 * allowlist here to put a claim in.
 *
 * The Uplink half is what makes the third instance nameable. That one was an
 * Uplink publishing one of its OWN enums, and an Uplink's types generate into
 * its own `client/src/__generated__`, so a sweep over the core slice alone can
 * pin the mechanism (`case System.Enum`) without ever reaching the type that
 * broke.
 *
 * ## Living in core's scan suite
 *
 * It reads the whole mod tree, so it needs the cache key that covers it. Same
 * reasoning as `asyncapi-document.test.ts` beside it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

interface Verdict {
  slice: string;
  name: string;
  via: string;
  root: boolean;
  verdict: "written" | "never-built" | "producer-flattened" | "uncovered";
  detail: string;
}

interface Slice {
  id: string;
  core: boolean;
  roots: number;
  reached: number;
}

interface Report {
  roots: number;
  reached: number;
  writable: number;
  files: number;
  slices: Slice[];
  uplinkSlices: number;
  uplinkRoots: number;
  uplinkReached: number;
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
      sliceOwned?: boolean;
    },
  ) => { verdict: string; detail: string };
  productionSources: (root?: string) => { path: string; text: string }[];
  contractSlices: (root?: string) => {
    id: string;
    core: boolean;
    contract: string;
    maps: [string, string][];
  }[];
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

  it("reaches every Uplink's own contract slice", () => {
    // An Uplink owns its wire types, and a walk that reads only the core slice
    // cannot see them: that is how the third instance of this bug class, an
    // Uplink publishing one of its OWN enums, sat outside the sweep. A
    // discovery that matches nothing hashes nothing and reports a clean tree,
    // so the count is floored rather than trusted. Six slices since three
    // Uplinks left for the gonogo-uplinks repo on 2026-09-06.
    expect(report.uplinkSlices).toBeGreaterThan(4);
    expect(report.uplinkRoots).toBeGreaterThan(40);
    expect(report.uplinkReached).toBeGreaterThan(40);
    // Every discovered slice actually contributed, rather than the total being
    // carried by one large Uplink while the rest silently walked nothing.
    for (const slice of report.slices) expect(slice.roots).toBeGreaterThan(0);
  });

  it("discovers the Uplink slices rather than listing them", () => {
    // A hand-written roster here would be the twelfth in this repo with no gate
    // on its own completeness, so the slices come off `uplink-matrix.mjs`. This
    // pins that they do: every discovered slice's contract path sits under the
    // Uplink directory the matrix named, and none is spelled out in this file.
    const slices = gate.contractSlices(REPO_ROOT);
    const ids = execFileSync("node", ["scripts/uplink-matrix.mjs", "--ids"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    for (const slice of slices.filter((entry) => !entry.core)) {
      expect(ids).toContain(slice.id);
      expect(slice.contract).toBe(
        `mod/${slice.id}/client/src/__generated__/contract.ts`,
      );
    }
  });

  it("does not let a core case cover an Uplink's own type of the same name", () => {
    // `JsonWriter` is in `Sitrep.Core` and a core serializer may not reference
    // an Uplink assembly, so every case it has names `Sitrep.Contract.*` and
    // none can meet an Uplink-owned type however it is spelled. Without this
    // distinction an Uplink declaring a `RepairOutcome` of its own would be
    // waved through by the core `RepairOutcome` case, which is the false green
    // this whole gate exists to refuse.
    const writable = gate.writableTypes(
      "case Sitrep.Contract.Shared shared:\n",
    );
    const scanned = gate.scanCSharp([
      { path: "planted.cs", text: "var x = new Shared();" },
    ]);
    const input = {
      writable,
      constructed: scanned.constructed,
      flattened: scanned.flattened,
      root: true,
    };
    expect(gate.classify("Shared", input).verdict).toBe("written");
    expect(
      gate.classify("Shared", { ...input, sliceOwned: true }).verdict,
    ).toBe("uncovered");
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
        `${entry.name} (${entry.slice}, published on ${entry.via}, built in ${entry.detail})`,
    );
    expect(
      named,
      "These types reach the wire as raw POCOs with no JsonWriter case, so every " +
        "populated payload carrying one is dropped at the wire boundary and the " +
        "client sees nothing. Add a case plus an Append<Type> helper (mirror " +
        "AppendCommsDelay), or flatten the value in its producer through a NAMED " +
        "method that takes the type and returns Dictionary<string, object?>. An " +
        "UPLINK-owned type has only the second option: a core serializer may not " +
        "reference an Uplink assembly, so flatten it in the Uplink before Publish, " +
        "the way every Uplink-owned payload on the wire today already does.",
    ).toEqual([]);
  });
});
