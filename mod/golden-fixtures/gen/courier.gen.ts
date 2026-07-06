#!/usr/bin/env tsx
/**
 * Golden-fixture generator for `mod/sitrep-server/src/courier.ts`'s
 * `Courier` — the reference delay engine for both TELEMETRY (streams) and
 * COMMANDS (round-trip request/response).
 *
 * Like `StubNetwork`/`Archive`, `Courier` is stateful with no single global
 * observable value — but unlike those, its observations are ASYNCHRONOUS:
 * a stream subscriber or command response callback can fire either
 * synchronously (subscribe-time catch-up) or later, when a scheduled Clock
 * callback drains during `advanceTo`. So a scenario's `ops` list (`record`,
 * `subscribeStream`, `unsubscribeStream`, `setCommandHandler`,
 * `dispatchCommand`, `advanceTo`) is run against one real `Courier` wired to
 * a real `ManualClock` + `StubNetwork`, and EVERY callback invocation
 * (stream delivery or command response) is appended, in the exact order it
 * actually fired, to a single `expected.events` log — this is what lets a
 * single big `advanceTo` that drains several deliveries in one batch be
 * checked for both order and for each delivery reporting its own captured
 * fire-UT (not a shared re-read of `clock.now()`).
 *
 * `setCommandHandler` always installs the SAME fixed handler
 * (`defaultCommandHandler` below) — deterministic and JSON-fixture-free,
 * mirroring `command => ({ ok: command, args, node })` from
 * `courier-command.test.ts`.
 *
 * The `expected` log is NEVER hand-authored: `runScenario` executes the ops
 * against a real `Courier` and records what actually happened. Both the TS
 * reference (already covered by `courier.test.ts` / `courier-command.test.ts`)
 * and the C# port (`Sitrep.Core.Tests/CourierGoldenFixtureTests.cs`) are
 * checked against this same file.
 *
 * Run with: `pnpm --filter @gonogo/sitrep-server gen:golden-fixtures`
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ManualClock } from "../../sitrep-server/src/clock.ts";
import { Courier } from "../../sitrep-server/src/courier.ts";
import { StubNetwork } from "../../sitrep-server/src/stub-network.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "courier.json");

interface RecordOp {
  op: "record";
  node: string;
  topic: string;
  value: unknown;
  validAtUt: number;
}

interface SubscribeStreamOp {
  op: "subscribeStream";
  /** Id this subscription is referred to by in later ops and in events. */
  id: string;
  node: string;
  topic: string;
  vantage: string;
}

interface UnsubscribeStreamOp {
  op: "unsubscribeStream";
  /** Id of a previous `subscribeStream` op. */
  id: string;
}

interface SetCommandHandlerOp {
  op: "setCommandHandler";
}

interface DispatchCommandOp {
  op: "dispatchCommand";
  node: string;
  requestId: string;
  command: string;
  args: unknown;
  vantage: string;
}

interface AdvanceToOp {
  op: "advanceTo";
  ut: number;
}

type Op =
  | RecordOp
  | SubscribeStreamOp
  | UnsubscribeStreamOp
  | SetCommandHandlerOp
  | DispatchCommandOp
  | AdvanceToOp;

interface DelayEntry {
  vantage: string;
  node: string;
  seconds: number;
}

interface ReachableEntry {
  vantage: string;
  node: string;
  ok: boolean;
}

interface NetworkConfig {
  defaults?: { delay?: number; reachable?: boolean };
  scale?: number;
  setDelay?: DelayEntry[];
  setReachable?: ReachableEntry[];
}

interface StreamEvent {
  kind: "stream";
  /** Which `subscribeStream` op's subscriber received this delivery. */
  subscribeId: string;
  topic: string;
  payload: unknown;
  source: string;
  vantage: string;
  validAt: number;
  deliveredAt: number;
  seq: number;
}

interface CommandEvent {
  kind: "command";
  requestId: string;
  result: unknown;
  source: string;
  vantage: string;
  validAt: number;
  deliveredAt: number;
  seq: number;
}

type ObservedEvent = StreamEvent | CommandEvent;

interface Scenario {
  name: string;
  description: string;
  network?: NetworkConfig;
  ops: Op[];
}

interface ScenarioResult extends Scenario {
  expected: { events: ObservedEvent[] };
}

/** The single fixed command handler every `setCommandHandler` op installs. */
function defaultCommandHandler(
  command: string,
  args: unknown,
  node: string,
): unknown {
  return { ok: command, args: args ?? null, node };
}

function buildNetwork(config: NetworkConfig | undefined): StubNetwork {
  const network = new StubNetwork(
    config?.defaults?.delay,
    config?.defaults?.reachable,
    config?.scale,
  );
  for (const entry of config?.setDelay ?? []) {
    network.setDelay(entry.vantage, entry.node, entry.seconds);
  }
  for (const entry of config?.setReachable ?? []) {
    network.setReachable(entry.vantage, entry.node, entry.ok);
  }
  return network;
}

/** Runs a scenario's ops against a real `Courier` and records every observed callback. */
function runScenario(scenario: Scenario): ScenarioResult {
  const clock = new ManualClock();
  const network = buildNetwork(scenario.network);
  const courier = new Courier({ clock, network });

  const events: ObservedEvent[] = [];
  const unsubById = new Map<string, () => void>();

  for (const op of scenario.ops) {
    switch (op.op) {
      case "record":
        courier.record(op.node, op.topic, op.value, op.validAtUt);
        break;

      case "subscribeStream": {
        const unsub = courier.subscribeStream(
          op.node,
          op.topic,
          op.vantage,
          (msg) => {
            events.push({
              kind: "stream",
              subscribeId: op.id,
              topic: msg.topic,
              payload: msg.payload,
              source: msg.meta.source,
              vantage: msg.meta.vantage,
              validAt: msg.meta.validAt,
              deliveredAt: msg.meta.deliveredAt,
              seq: msg.meta.seq,
            });
          },
        );
        unsubById.set(op.id, unsub);
        break;
      }

      case "unsubscribeStream": {
        const unsub = unsubById.get(op.id);
        if (!unsub) {
          throw new Error(
            `unsubscribeStream op referenced unknown subscribeStream id "${op.id}"`,
          );
        }
        unsub();
        break;
      }

      case "setCommandHandler":
        courier.setCommandHandler(defaultCommandHandler);
        break;

      case "dispatchCommand":
        courier.dispatchCommand(
          op.node,
          op.requestId,
          op.command,
          op.args,
          op.vantage,
          (msg) => {
            events.push({
              kind: "command",
              requestId: msg.requestId,
              result: msg.result,
              source: msg.meta.source,
              vantage: msg.meta.vantage,
              validAt: msg.meta.validAt,
              deliveredAt: msg.meta.deliveredAt,
              seq: msg.meta.seq,
            });
          },
        );
        break;

      case "advanceTo":
        clock.advanceTo(op.ut);
        break;
    }
  }

  return { ...scenario, expected: { events } };
}

const scenarios: Scenario[] = [
  {
    name: "delivers-at-valid-at-plus-delay",
    description:
      "A recorded sample is delivered to a subscriber exactly at validAt + delayTo(vantage, node), not before.",
    network: { setDelay: [{ vantage: "KSC", node: "vessel", seconds: 2 }] },
    ops: [
      {
        op: "subscribeStream",
        id: "s1",
        node: "vessel",
        topic: "alt",
        vantage: "KSC",
      },
      { op: "record", node: "vessel", topic: "alt", value: 100, validAtUt: 0 },
      { op: "advanceTo", ut: 1 },
      { op: "advanceTo", ut: 2 },
    ],
  },
  {
    name: "two-vantages-independent-delay",
    description:
      "The same recorded sample is delivered to two vantages independently, each arriving at its own delayTo offset, with no duplicate delivery to the nearer vantage.",
    network: {
      setDelay: [
        { vantage: "KSC", node: "vessel", seconds: 2 },
        { vantage: "DSN", node: "vessel", seconds: 5 },
      ],
    },
    ops: [
      {
        op: "subscribeStream",
        id: "ksc",
        node: "vessel",
        topic: "alt",
        vantage: "KSC",
      },
      {
        op: "subscribeStream",
        id: "dsn",
        node: "vessel",
        topic: "alt",
        vantage: "DSN",
      },
      { op: "record", node: "vessel", topic: "alt", value: 100, validAtUt: 0 },
      { op: "advanceTo", ut: 2 },
      { op: "advanceTo", ut: 5 },
    ],
  },
  {
    name: "subscribe-during-transit-schedules-in-flight",
    description:
      "A subscriber joining while a recorded sample is still in flight (validAt + delay > now) gets neither a catch-up (nothing has arrived yet) nor a miss — it is scheduled and delivered once the sample arrives.",
    network: { setDelay: [{ vantage: "KSC", node: "vessel", seconds: 2 }] },
    ops: [
      { op: "record", node: "vessel", topic: "alt", value: 100, validAtUt: 0 },
      { op: "advanceTo", ut: 1 },
      {
        op: "subscribeStream",
        id: "s1",
        node: "vessel",
        topic: "alt",
        vantage: "KSC",
      },
      { op: "advanceTo", ut: 2 },
    ],
  },
  {
    name: "catch-up-on-subscribe-after-arrival",
    description:
      "A subscriber joining AFTER a sample has already arrived at that vantage gets an immediate synchronous catch-up delivery, with deliveredAt reflecting the subscribe-time UT rather than the original arrival UT.",
    network: { setDelay: [{ vantage: "KSC", node: "vessel", seconds: 2 }] },
    ops: [
      { op: "record", node: "vessel", topic: "alt", value: 100, validAtUt: 0 },
      { op: "advanceTo", ut: 3 },
      {
        op: "subscribeStream",
        id: "s1",
        node: "vessel",
        topic: "alt",
        vantage: "KSC",
      },
    ],
  },
  {
    name: "unsubscribe-before-delivery-drops-it",
    description:
      "Unsubscribing before a scheduled delivery fires removes the subscriber entirely — no event for it, even once the delivery's UT is reached.",
    network: { setDelay: [{ vantage: "KSC", node: "vessel", seconds: 2 }] },
    ops: [
      {
        op: "subscribeStream",
        id: "s1",
        node: "vessel",
        topic: "alt",
        vantage: "KSC",
      },
      { op: "record", node: "vessel", topic: "alt", value: 100, validAtUt: 0 },
      { op: "unsubscribeStream", id: "s1" },
      { op: "advanceTo", ut: 2 },
    ],
  },
  {
    name: "batch-advance-delivers-each-once-in-order",
    description:
      "A single large advanceTo() jump spanning several arrivals delivers each sample exactly once, in ascending arrival order, each event reporting its OWN captured fire-UT rather than the final clock.now() the batch lands on.",
    network: { setDelay: [{ vantage: "KSC", node: "vessel", seconds: 2 }] },
    ops: [
      {
        op: "subscribeStream",
        id: "s1",
        node: "vessel",
        topic: "alt",
        vantage: "KSC",
      },
      { op: "record", node: "vessel", topic: "alt", value: 0, validAtUt: 0 },
      { op: "record", node: "vessel", topic: "alt", value: 1, validAtUt: 1 },
      { op: "record", node: "vessel", topic: "alt", value: 2, validAtUt: 2 },
      { op: "advanceTo", ut: 20 },
    ],
  },
  {
    name: "command-executes-at-uplink-confirms-at-uplink-plus-downlink",
    description:
      "A dispatched command's confirmation is delivered at t0 + up + down (symmetric uplink/downlink), reporting validAt = the execute UT and deliveredAt = the confirm UT.",
    network: { setDelay: [{ vantage: "KSC", node: "vessel", seconds: 2 }] },
    ops: [
      { op: "setCommandHandler" },
      {
        op: "dispatchCommand",
        node: "vessel",
        requestId: "r1",
        command: "deploy",
        args: null,
        vantage: "KSC",
      },
      { op: "advanceTo", ut: 1 },
      { op: "advanceTo", ut: 2 },
      { op: "advanceTo", ut: 4 },
    ],
  },
  {
    name: "command-round-trip-with-args-echoed",
    description:
      "dispatchCommand's args reach the handler and flow through into the response result, verified via the deterministic default handler that echoes them back.",
    network: { setDelay: [{ vantage: "KSC", node: "vessel", seconds: 1 }] },
    ops: [
      { op: "setCommandHandler" },
      {
        op: "dispatchCommand",
        node: "vessel",
        requestId: "r2",
        command: "set-throttle",
        args: { value: 0.5 },
        vantage: "KSC",
      },
      { op: "advanceTo", ut: 2 },
    ],
  },
  {
    name: "loss-unreachable-drops-command-with-honest-silence",
    description:
      "A command dispatched to an unreachable node is dropped entirely at dispatch time — the handler never runs and no response event ever fires, even after a huge advance.",
    network: {
      setDelay: [{ vantage: "KSC", node: "vessel", seconds: 2 }],
      setReachable: [{ vantage: "KSC", node: "vessel", ok: false }],
    },
    ops: [
      { op: "setCommandHandler" },
      {
        op: "dispatchCommand",
        node: "vessel",
        requestId: "r3",
        command: "deploy",
        args: null,
        vantage: "KSC",
      },
      { op: "advanceTo", ut: 1000 },
    ],
  },
  {
    name: "multiple-commands-and-streams-interleave-by-fire-ut",
    description:
      "Stream deliveries and command responses interleave in real fire-UT order across a single batched advance, each still reporting its own captured UT and a monotonically increasing per-courier seq.",
    network: { setDelay: [{ vantage: "KSC", node: "vessel", seconds: 2 }] },
    ops: [
      { op: "setCommandHandler" },
      {
        op: "subscribeStream",
        id: "s1",
        node: "vessel",
        topic: "alt",
        vantage: "KSC",
      },
      { op: "record", node: "vessel", topic: "alt", value: 10, validAtUt: 0 },
      {
        op: "dispatchCommand",
        node: "vessel",
        requestId: "r4",
        command: "ping",
        args: null,
        vantage: "KSC",
      },
      { op: "record", node: "vessel", topic: "alt", value: 20, validAtUt: 1 },
      { op: "advanceTo", ut: 10 },
    ],
  },
];

const results = scenarios.map(runScenario);

writeFileSync(OUT_FILE, `${JSON.stringify(results, null, 2)}\n`);
console.log(`golden-fixtures -> ${OUT_FILE} (${results.length} scenarios)`);
