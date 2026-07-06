#!/usr/bin/env tsx
/**
 * Golden-fixture generator for `mod/sitrep-server/src/stub-network.ts`'s
 * `StubNetwork`.
 *
 * Like `ManualClock`, `StubNetwork` is stateful, so its fixture is a
 * **scripted scenario**: a constructor call (defaults + scale) followed by a
 * sequence of ops run against one instance. Unlike Clock's scenarios (which
 * only observe a global fired-order + final now()), StubNetwork's
 * observations are *inline*: a scenario's `ops` list interleaves mutations
 * (`setDelay` / `setReachable` / `setScale`) with queries (`queryDelay` /
 * `queryReachable`), and each query op is enriched with the `expected` value
 * the TS instance actually returned when it was reached — so ordering (e.g.
 * "query, then setScale, then query again") is preserved exactly.
 *
 * The `expected` fields are NEVER hand-authored: `runScenario` executes the
 * ops against a real `StubNetwork` and records what actually happened. Both
 * the TS reference (already covered by `stub-network.test.ts`) and the C#
 * port (`Sitrep.Core.Tests/StubNetworkGoldenFixtureTests.cs`) are checked
 * against this same file.
 *
 * Run with: `pnpm --filter @gonogo/sitrep-server gen:golden-fixtures`
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StubNetwork } from "../../sitrep-server/src/stub-network.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "stub-network.json");

interface SetDelayOp {
  op: "setDelay";
  vantage: string;
  node: string;
  seconds: number;
}

interface SetReachableOp {
  op: "setReachable";
  vantage: string;
  node: string;
  ok: boolean;
}

interface SetScaleOp {
  op: "setScale";
  scale: number;
}

interface QueryDelayOp {
  op: "queryDelay";
  vantage: string;
  node: string;
  /** Filled in by `runScenario` from the real TS instance — never hand-authored. */
  expected?: number;
}

interface QueryReachableOp {
  op: "queryReachable";
  vantage: string;
  node: string;
  /** Filled in by `runScenario` from the real TS instance — never hand-authored. */
  expected?: boolean;
}

type Op =
  | SetDelayOp
  | SetReachableOp
  | SetScaleOp
  | QueryDelayOp
  | QueryReachableOp;

interface Scenario {
  name: string;
  description: string;
  /** Constructor `defaults` arg. Omitted entirely when the scenario relies on StubNetwork's own defaults. */
  defaults?: { delay?: number; reachable?: boolean };
  /** Constructor `scale` arg. Omitted entirely when the scenario relies on the default (1). */
  scale?: number;
  ops: Op[];
}

/** Runs a scenario's ops against a real `StubNetwork` and fills in each query's `expected`. */
function runScenario(scenario: Scenario): Scenario {
  const network =
    scenario.scale === undefined
      ? new StubNetwork(scenario.defaults)
      : new StubNetwork(scenario.defaults, scenario.scale);

  const ops: Op[] = scenario.ops.map((op) => {
    switch (op.op) {
      case "setDelay":
        network.setDelay(op.vantage, op.node, op.seconds);
        return op;
      case "setReachable":
        network.setReachable(op.vantage, op.node, op.ok);
        return op;
      case "setScale":
        network.setScale(op.scale);
        return op;
      case "queryDelay":
        return { ...op, expected: network.delayTo(op.vantage, op.node) };
      case "queryReachable":
        return { ...op, expected: network.reachable(op.vantage, op.node) };
      default:
        throw new Error(`Unknown golden-fixture op: ${(op as Op).op}`);
    }
  });

  return { ...scenario, ops };
}

const scenarios: Scenario[] = [
  {
    name: "defaults-unset-pairs",
    description:
      "Every unset (vantage, node) pair defaults to delay 0 and reachable true when no constructor defaults are given.",
    ops: [
      { op: "queryDelay", vantage: "KSC", node: "v1" },
      { op: "queryReachable", vantage: "KSC", node: "v1" },
      { op: "queryDelay", vantage: "anywhere", node: "anything" },
      { op: "queryReachable", vantage: "anywhere", node: "anything" },
    ],
  },
  {
    name: "constructor-defaults-override-unset-pairs",
    description:
      "Constructor-provided defaults (delay, reachable) apply to any pair that hasn't been explicitly pinned.",
    defaults: { delay: 120, reachable: false },
    ops: [
      { op: "queryDelay", vantage: "KSC", node: "v1" },
      { op: "queryReachable", vantage: "KSC", node: "v1" },
    ],
  },
  {
    name: "set-delay-isolated-to-its-pair",
    description:
      "setDelay overrides delay only for the exact (vantage, node) pair; other pairs (same vantage, different node; same node, different vantage) stay at default.",
    ops: [
      { op: "setDelay", vantage: "KSC", node: "v1", seconds: 240 },
      { op: "queryDelay", vantage: "KSC", node: "v1" },
      { op: "queryDelay", vantage: "KSC", node: "v2" },
      { op: "queryDelay", vantage: "Woomera", node: "v1" },
    ],
  },
  {
    name: "set-reachable-isolated-to-its-pair",
    description:
      "setReachable overrides reachability only for the exact pair; other pairs stay at default.",
    ops: [
      { op: "setReachable", vantage: "KSC", node: "v1", ok: false },
      { op: "queryReachable", vantage: "KSC", node: "v1" },
      { op: "queryReachable", vantage: "KSC", node: "v2" },
      { op: "queryReachable", vantage: "Woomera", node: "v1" },
    ],
  },
  {
    name: "delay-and-reachable-are-independent-axes",
    description:
      "Setting delay for a pair doesn't touch its reachability, and vice versa — they're tracked in separate maps.",
    ops: [
      { op: "setDelay", vantage: "KSC", node: "v1", seconds: 300 },
      { op: "queryDelay", vantage: "KSC", node: "v1" },
      { op: "queryReachable", vantage: "KSC", node: "v1" },
      { op: "setReachable", vantage: "KSC", node: "v1", ok: false },
      { op: "queryReachable", vantage: "KSC", node: "v1" },
      { op: "queryDelay", vantage: "KSC", node: "v1" },
    ],
  },
  {
    name: "re-setting-a-pair-overwrites-the-previous-value",
    description:
      "Calling setDelay twice for the same pair keeps the latest value, not the first.",
    ops: [
      { op: "setDelay", vantage: "KSC", node: "v1", seconds: 50 },
      { op: "setDelay", vantage: "KSC", node: "v1", seconds: 75 },
      { op: "queryDelay", vantage: "KSC", node: "v1" },
    ],
  },
  {
    name: "collision-safe-keying-ab-c-vs-a-bc",
    description:
      "Pairs are keyed with a nested map (vantage -> node -> value), not string concatenation, so ('ab','c') and ('a','bc') never collide.",
    ops: [
      { op: "setDelay", vantage: "ab", node: "c", seconds: 111 },
      { op: "queryDelay", vantage: "ab", node: "c" },
      { op: "queryDelay", vantage: "a", node: "bc" },
      { op: "setDelay", vantage: "a", node: "bc", seconds: 222 },
      { op: "queryDelay", vantage: "ab", node: "c" },
      { op: "queryDelay", vantage: "a", node: "bc" },
    ],
  },
  {
    name: "scale-defaults-to-1-unscaled",
    description:
      "With no scale argument, delayTo returns the base delay unscaled, both for the default delay and a pinned pair.",
    defaults: { delay: 120 },
    ops: [
      { op: "setDelay", vantage: "KSC", node: "v1", seconds: 240 },
      { op: "queryDelay", vantage: "KSC", node: "v1" },
      { op: "queryDelay", vantage: "KSC", node: "v2" },
    ],
  },
  {
    name: "set-scale-multiplies-default-and-pinned-delays",
    description:
      "setScale(2) doubles both the default delay and any pinned pair's delay.",
    defaults: { delay: 120 },
    ops: [
      { op: "setDelay", vantage: "KSC", node: "v1", seconds: 240 },
      { op: "setScale", scale: 2 },
      { op: "queryDelay", vantage: "KSC", node: "v1" },
      { op: "queryDelay", vantage: "KSC", node: "v2" },
    ],
  },
  {
    name: "set-scale-zero-collapses-every-delay",
    description:
      "setScale(0) zeroes delay for every pair — default, pinned, and never-touched alike (light-speed-instant collapse).",
    defaults: { delay: 120 },
    ops: [
      { op: "setDelay", vantage: "KSC", node: "v1", seconds: 240 },
      { op: "setScale", scale: 0 },
      { op: "queryDelay", vantage: "KSC", node: "v1" },
      { op: "queryDelay", vantage: "KSC", node: "v2" },
      { op: "queryDelay", vantage: "anywhere", node: "anything" },
    ],
  },
  {
    name: "scale-never-affects-reachable",
    description:
      "Scale is delay-only; reachable is a separate binary axis untouched by setScale(0).",
    ops: [
      { op: "setReachable", vantage: "KSC", node: "v1", ok: false },
      { op: "setScale", scale: 0 },
      { op: "queryReachable", vantage: "KSC", node: "v1" },
      { op: "queryReachable", vantage: "KSC", node: "v2" },
    ],
  },
  {
    name: "constructor-scale-argument",
    description:
      "The constructor's second (scale) argument applies from the very first delayTo call.",
    defaults: { delay: 100 },
    scale: 0,
    ops: [{ op: "queryDelay", vantage: "KSC", node: "v1" }],
  },
  {
    name: "set-scale-can-be-changed-again-after-being-set",
    description:
      "setScale is not one-shot: setting it to 0 then back to 1 flips delayTo's output back and forth on subsequent calls.",
    defaults: { delay: 100 },
    ops: [
      { op: "setScale", scale: 0 },
      { op: "queryDelay", vantage: "KSC", node: "v1" },
      { op: "setScale", scale: 1 },
      { op: "queryDelay", vantage: "KSC", node: "v1" },
    ],
  },
  {
    name: "negative-set-scale-clamps-to-zero",
    description:
      "setScale(-1) clamps to 0 rather than negating delay — a negative scale would schedule deliveries in the past.",
    defaults: { delay: 100 },
    ops: [
      { op: "setScale", scale: -1 },
      { op: "queryDelay", vantage: "KSC", node: "v1" },
    ],
  },
  {
    name: "negative-constructor-scale-clamps-to-zero",
    description:
      "A negative scale passed to the constructor is clamped to 0, same as setScale.",
    defaults: { delay: 100 },
    scale: -5,
    ops: [{ op: "queryDelay", vantage: "KSC", node: "v1" }],
  },
];

const results = scenarios.map(runScenario);

writeFileSync(OUT_FILE, `${JSON.stringify(results, null, 2)}\n`);
console.log(`golden-fixtures -> ${OUT_FILE} (${results.length} scenarios)`);
