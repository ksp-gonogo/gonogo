import { describe, expect, it } from "vitest";
import { TOPIC_VALUE_DEBT } from "./one-home-modelling.debt";
import {
  contractTypeNames,
  type Finding,
  gradeAgainstDebt,
  importedNames,
  listSources,
  printReport,
  type SourceFile,
  scanRoot,
  stripComments,
} from "./one-home-modelling.scan";
import { ratchetRepoRoot } from "./ratchetBaseRef";

/**
 * One-home report 2: synthetic Topic values.
 *
 * A Topic value that does not come from the mod (a replay, a prediction
 * feeder, the design overlay, a fixture builder the app or the sdk ships) has
 * to be built as the generated contract type from
 * `mod/sitrep-sdk/src/__generated__/contract.ts`. A value built as a loose
 * literal, a `Partial`, or behind a cast can lose a contract field and nothing
 * notices, because every reader of the missing field sees `undefined`.
 *
 * How a file is judged, in two steps.
 *
 * 1. Producer. A non-test file is a producer when it builds a value for a
 *    Topic and hands it to the stream or the client store. The signals are:
 *    an object literal whose `type` is `"stream-data"` (a frame being built,
 *    not compared), a call to the store's `ingest`, or a path naming a
 *    producer role (`Feeder`, `predictedFrames`, `editorAdapter`,
 *    `Synthetic`, `fixtureBuilders`, `stream-fixture`, `stub-transport`).
 *    Code that only reads, forwards or compares frames matches none of these
 *    unless it also builds one. The path signal exists because a producer can
 *    pass its frames to a helper and carry no frame literal of its own.
 * 2. Contract-shaped. A producer passes when it imports at least one name
 *    that `contract.ts` exports, and shows none of the loose signals:
 *    `Partial<...>`, `as unknown as`, `as any`, `: any`, `Record<string,
 *    unknown>`, or an `as Name` cast (`as const` is fine). A producer with no
 *    contract import, or with any loose signal, is a finding.
 *
 * The test is file-level and heuristic. It cannot say a given payload is wrong,
 * only that nothing in the file makes it right, and a finding on a producer
 * that forwards frames it did not build is a debt entry with that reason.
 * `Meta` and other envelope types come from the contract too, so importing one
 * counts; a file that builds a payload and imports only an envelope type is a
 * false pass, which is the cost of staying cheap.
 *
 * Scope: the shared source scope, plus the test-support directories that ship
 * (`testing/`, `fixtureBuilders/`, `test/`), since a fixture builder is a
 * producer. `*.test.*` files and JSON fixtures are skipped. Report only: a
 * finding never fails; the test fails as `BLIND` or on a broken scan.
 */

const PRODUCER_PATH =
  /(Feeder|predictedFrames|editorAdapter|Synthetic|fixtureBuilders|stream-fixture|stub-transport)/;

/** The store and client are the pipeline the producers write into, not producers. */
const PIPELINE = new Set([
  "mod/sitrep-sdk/src/spine/client.ts",
  "mod/sitrep-sdk/src/spine/timeline-store.ts",
]);

const LOOSE: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: "Partial<...>", pattern: /\bPartial</ },
  { label: "as unknown as", pattern: /\bas\s+unknown\s+as\b/ },
  { label: "as any / : any", pattern: /\bas\s+any\b|:\s*any\b/ },
  {
    label: "Record<string, unknown>",
    pattern: /Record<\s*string\s*,\s*unknown\s*>/,
  },
  {
    label: "`as Name` cast",
    pattern: /\bas\s+(?!const\b|unknown\b|any\b)[A-Z]\w*/,
  },
];

function producerSignals(path: string, code: string): string[] {
  const out: string[] = [];
  if (/\btype:\s*"stream-data"(?!\s*\|)/.test(code))
    out.push("builds a stream-data frame");
  if (/\.ingest\s*(?:<[^>]*>)?\s*\(/.test(code)) out.push("calls store.ingest");
  if (PRODUCER_PATH.test(path)) out.push("producer-named path");
  return out;
}

function scanTopicValues(
  sources: readonly SourceFile[],
  contract: ReadonlySet<string>,
): Finding[] {
  const out: Finding[] = [];
  for (const file of sources) {
    if (PIPELINE.has(file.path)) continue;
    const code = stripComments(file.text);
    const signals = producerSignals(file.path, code);
    if (signals.length === 0) continue;
    const problems: string[] = [];
    const imported = importedNames(code);
    if (![...imported].some((n) => contract.has(n))) {
      problems.push("imports no contract type");
    }
    for (const loose of LOOSE) {
      if (loose.pattern.test(code)) problems.push(loose.label);
    }
    if (problems.length === 0) continue;
    out.push({
      key: file.path,
      where: file.path,
      detail: `[${signals.join(", ")}] ${problems.join(", ")}`,
    });
  }
  return out;
}

const root = scanRoot(ratchetRepoRoot());
const sources = listSources(root, { includeTestSupport: true });
const contract = contractTypeNames(root);
const report = gradeAgainstDebt(
  "one-home topic values",
  scanTopicValues(sources, contract),
  TOPIC_VALUE_DEBT,
  sources.length,
);
printReport(report);

describe("one-home report: synthetic Topic values", () => {
  it("read a believable number of sources and contract types", () => {
    expect(sources.length).toBeGreaterThan(1000);
    expect(contract.size).toBeGreaterThan(100);
  });

  it("carries a reason on every debt entry", () => {
    expect(report.unexplained).toEqual([]);
  });

  it("is not BLIND: sees a planted producer that casts a loose literal", () => {
    const planted: SourceFile = {
      path: "packages/planted/src/PlantedFeeder.tsx",
      text: [
        'import type { Reading } from "./elsewhere";',
        "export function frame(): unknown {",
        '  return { type: "stream-data", topic: "vessel.flight", payload: { altitude: 1 } as Partial<object> };',
        "}",
      ].join("\n"),
    };
    const found = scanTopicValues([planted], contract);
    expect(found).toHaveLength(1);
    expect(found[0]?.detail).toContain("Partial<...>");
    expect(found[0]?.detail).toContain("imports no contract type");
  });

  it("passes a producer that imports a contract type and casts nothing", () => {
    const [someType] = [...contract];
    const clean: SourceFile = {
      path: "packages/planted/src/CleanFeeder.tsx",
      text: [
        `import type { ${someType} } from "@ksp-gonogo/sitrep-sdk";`,
        `export const frame = (payload: ${someType}) => ({ type: "stream-data", topic: "t", payload });`,
      ].join("\n"),
    };
    expect(scanTopicValues([clean], contract)).toEqual([]);
  });
});
