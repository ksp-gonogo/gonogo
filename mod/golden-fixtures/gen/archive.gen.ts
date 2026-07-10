#!/usr/bin/env tsx
/**
 * Golden-fixture generator for `mod/sitrep-server/src/archive.ts`'s `Archive`
 * — specifically its READ behavior (`record` / `readAtVantage`). The C#-only
 * snapshot/restore addition (for M5b quicksave) has no TS reference and is
 * NOT covered here — it's tested C#-side against a fresh `Archive` instance
 * (see `Sitrep.Core.Tests/ArchiveSnapshotRestoreTests.cs`).
 *
 * Like `StubNetwork`, `Archive` is stateful with no single global observable
 * output: a scenario's `ops` list interleaves mutations (`record`) with
 * queries (`readAtVantage`), and each `readAtVantage` op carries the
 * `expected` result — `{ value, validAt }` or `null` (JSON has no
 * `undefined`) — the real TS instance actually returned when it was reached.
 * This preserves the exact call order the freeze-on-recession and
 * two-vantage-independence semantics depend on.
 *
 * The `expected` fields are NEVER hand-authored: `runScenario` executes the
 * ops against a real `Archive` and records what actually happened. Both the
 * TS reference (already covered by `archive.test.ts`) and the C# port
 * (`Sitrep.Core.Tests/ArchiveGoldenFixtureTests.cs`) are checked against this
 * same file.
 *
 * Run with: `pnpm --filter @ksp-gonogo/sitrep-server gen:golden-fixtures`
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Archive } from "../../sitrep-server/src/archive.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "archive.json");

interface RecordOp {
  op: "record";
  topic: string;
  value: unknown;
  validAtUt: number;
}

interface ReadAtVantageOp {
  op: "readAtVantage";
  topic: string;
  vantage: string;
  delaySeconds: number;
  nowUt: number;
  /** Filled in by `runScenario` from the real TS instance — never hand-authored. */
  expected?: { value: unknown; validAt: number } | null;
}

type Op = RecordOp | ReadAtVantageOp;

interface Scenario {
  name: string;
  description: string;
  ops: Op[];
}

/** Runs a scenario's ops against a real `Archive` and fills in each read's `expected`. */
function runScenario(scenario: Scenario): Scenario {
  const archive = new Archive();

  const ops: Op[] = scenario.ops.map((op) => {
    switch (op.op) {
      case "record":
        archive.record(op.topic, op.value, op.validAtUt);
        return op;
      case "readAtVantage": {
        const result = archive.readAtVantage(
          op.topic,
          op.vantage,
          op.delaySeconds,
          op.nowUt,
        );
        return { ...op, expected: result === undefined ? null : result };
      }
      default:
        throw new Error(`Unknown golden-fixture op: ${(op as Op).op}`);
    }
  });

  return { ...scenario, ops };
}

const scenarios: Scenario[] = [
  {
    name: "basic-read",
    description:
      "readAtVantage returns the latest sample with validAt <= sceneUt (nowUt - delaySeconds).",
    ops: [
      { op: "record", topic: "v.altitude", value: 100, validAtUt: 0 },
      { op: "record", topic: "v.altitude", value: 200, validAtUt: 1 },
      { op: "record", topic: "v.altitude", value: 300, validAtUt: 2 },
      { op: "record", topic: "v.altitude", value: 400, validAtUt: 3 },
      {
        op: "readAtVantage",
        topic: "v.altitude",
        vantage: "v1",
        delaySeconds: 2,
        nowUt: 5,
      },
    ],
  },
  {
    name: "two-vantage-independence",
    description:
      "Two vantages reading the same archive at independent delay offsets get independent cursors and independent scenes.",
    ops: [
      { op: "record", topic: "v.altitude", value: 100, validAtUt: 0 },
      { op: "record", topic: "v.altitude", value: 200, validAtUt: 1 },
      { op: "record", topic: "v.altitude", value: 300, validAtUt: 2 },
      { op: "record", topic: "v.altitude", value: 400, validAtUt: 3 },
      {
        op: "readAtVantage",
        topic: "v.altitude",
        vantage: "v1",
        delaySeconds: 2,
        nowUt: 5,
      },
      {
        op: "readAtVantage",
        topic: "v.altitude",
        vantage: "v2",
        delaySeconds: 5,
        nowUt: 5,
      },
    ],
  },
  {
    name: "freeze-on-recession",
    description:
      "A vantage whose delay grows faster than time advances (the observer recedes) HOLDS its scene rather than rewinding to an earlier sample; once time advances past the frozen scene again, the read still reflects the (still-latest) sample.",
    ops: [
      { op: "record", topic: "v.altitude", value: 100, validAtUt: 0 },
      { op: "record", topic: "v.altitude", value: 200, validAtUt: 1 },
      { op: "record", topic: "v.altitude", value: 300, validAtUt: 2 },
      { op: "record", topic: "v.altitude", value: 400, validAtUt: 3 },
      // now=5, delay=2 -> scene=3 -> validAt 3.
      {
        op: "readAtVantage",
        topic: "v.altitude",
        vantage: "v1",
        delaySeconds: 2,
        nowUt: 5,
      },
      // now=6, delay=4 -> raw scene=2, BEHIND the previous scene of 3. Frozen: still validAt 3.
      {
        op: "readAtVantage",
        topic: "v.altitude",
        vantage: "v1",
        delaySeconds: 4,
        nowUt: 6,
      },
      // now=10, delay=4 -> raw scene=6, past the frozen scene again -> still validAt 3 (latest sample <= 6).
      {
        op: "readAtVantage",
        topic: "v.altitude",
        vantage: "v1",
        delaySeconds: 4,
        nowUt: 10,
      },
    ],
  },
  {
    name: "before-first-sample",
    description:
      "A clamped scene before the first recorded sample's validAt returns null (TS undefined).",
    ops: [
      { op: "record", topic: "v.altitude", value: 100, validAtUt: 10 },
      {
        op: "readAtVantage",
        topic: "v.altitude",
        vantage: "v1",
        delaySeconds: 2,
        nowUt: 5,
      },
    ],
  },
  {
    name: "read-before-any-record",
    description:
      "readAtVantage on a topic with no recorded samples at all returns null.",
    ops: [
      {
        op: "readAtVantage",
        topic: "nonexistent",
        vantage: "v1",
        delaySeconds: 0,
        nowUt: 100,
      },
    ],
  },
  {
    name: "out-of-order-record",
    description:
      "A sample recorded with a validAtUt earlier than the last-appended sample is inserted to keep the list ascending, and reads see it in the correct position rather than the record-call order.",
    ops: [
      { op: "record", topic: "v.altitude", value: 100, validAtUt: 0 },
      { op: "record", topic: "v.altitude", value: 400, validAtUt: 3 },
      // Out-of-order: validAt 2 recorded AFTER validAt 3.
      { op: "record", topic: "v.altitude", value: 300, validAtUt: 2 },
      // scene = 5 - 2 = 3 -> latest sample with validAt <= 3 is still the validAt-3 sample.
      {
        op: "readAtVantage",
        topic: "v.altitude",
        vantage: "v1",
        delaySeconds: 2,
        nowUt: 5,
      },
      // scene = 4 - 2 = 2 -> latest sample with validAt <= 2 is the out-of-order-inserted validAt-2 sample.
      {
        op: "readAtVantage",
        topic: "v.altitude",
        vantage: "v2",
        delaySeconds: 2,
        nowUt: 4,
      },
    ],
  },
  {
    name: "collision-safe-keying",
    description:
      "Cursors are keyed by (topic, vantage) via a nested map, not string concatenation, so topic 'ab'/vantage 'c' never collides with topic 'a'/vantage 'bc'.",
    ops: [
      { op: "record", topic: "ab", value: "topic-ab-c", validAtUt: 0 },
      { op: "record", topic: "a", value: "topic-a-bc", validAtUt: 0 },
      {
        op: "readAtVantage",
        topic: "ab",
        vantage: "c",
        delaySeconds: 0,
        nowUt: 0,
      },
      {
        op: "readAtVantage",
        topic: "a",
        vantage: "bc",
        delaySeconds: 0,
        nowUt: 0,
      },
    ],
  },
];

const results = scenarios.map(runScenario);

writeFileSync(OUT_FILE, `${JSON.stringify(results, null, 2)}\n`);
console.log(`golden-fixtures -> ${OUT_FILE} (${results.length} scenarios)`);
