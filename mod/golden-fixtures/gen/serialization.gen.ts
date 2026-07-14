#!/usr/bin/env tsx
/**
 * Golden-fixture generator for the envelope wire format
 * (`mod/sitrep-sdk/src/__generated__/contract.ts` + `envelope.ts`) — Task 7
 * of the M5a C# port.
 *
 * Unlike the other fixtures, there's no stateful TS reference class to run
 * scenarios against: the "reference implementation" being conformance-tested
 * IS `JSON.stringify` itself, plus the NaN/Infinity sentinel policy defined
 * here (see the big comment on `safeStringify` below). Each vector is one
 * representative message (every envelope variant, a Meta with normal
 * values, a Meta with an optional field omitted, and NaN/Infinity cases in
 * both a fixed-schema numeric field AND a free-form payload value) plus the
 * exact JSON string `safeStringify` produces for it.
 *
 * `Sitrep.Core.Tests/EnvelopeSerializationGoldenFixtureTests.cs` parses each
 * vector's `json` with the C# `EnvelopeCodec`, re-serializes the result, and
 * asserts it comes back byte-for-byte identical — proving the C# writer
 * produces the exact same on-wire shape the real TS SDK does for the same
 * message, sentinel encoding included.
 *
 * NOTE: `safeStringify`'s NaN/Infinity handling is NOT yet part of the
 * shipped SDK (`@ksp-gonogo/sitrep-sdk` has no `serialize`/`write` helper at
 * all today — only `parseServerMessage` for reading). This generator
 * defines the policy so the C# side has a real contract to conform to; a
 * later task should fold the same replacer into a real
 * `serializeServerMessage`/`serializeClientMessage` pair in the SDK so
 * production TS code and this fixture generator share one implementation
 * instead of the policy living only here.
 *
 * Run with: `pnpm --filter @ksp-gonogo/sitrep-server gen:golden-fixtures`
 * (chained after the other fixtures in that package's script).
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CommandRequest,
  type CommandResponse,
  type ErrorMsg,
  type EventMsg,
  type Meta,
  Quality,
  Staleness,
  type StreamData,
  type Subscribe,
  type Unsubscribe,
} from "../../sitrep-sdk/src/__generated__/contract.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "serialization.json");

/**
 * THE NaN/Infinity wire-format sentinel policy (TS side) — see
 * `Sitrep.Core/Serialization/NanPolicy.cs` for the matching C# definition,
 * which both sides must agree on for this fixture to mean anything.
 *
 * A browser's `JSON.parse` rejects bare `NaN`/`Infinity` tokens (invalid
 * JSON), and plain `JSON.stringify` silently collapses non-finite numbers to
 * `null` — losing the distinction between "no value" and "the value is
 * NaN", which matters here since KSP orbit math (eccentric anomaly, landing
 * telemetry) genuinely produces NaN on real vessels. Instead, a non-finite
 * number is encoded as one of three fixed JSON string tokens matching JS's
 * own `String(x)` conversion: `"NaN"`, `"Infinity"`, `"-Infinity"`.
 *
 * Applied UNIFORMLY via `JSON.stringify`'s replacer function, which is
 * invoked for every value in the tree (top-level fields and every nested
 * payload/args/result value alike) — there's no separate code path for
 * "schema" numbers vs "free-form" numbers, exactly mirroring
 * `JsonWriter.AppendNumber` being the C# side's single call site.
 */
function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    typeof v === "number" && !Number.isFinite(v)
      ? Number.isNaN(v)
        ? "NaN"
        : v > 0
          ? "Infinity"
          : "-Infinity"
      : v,
  );
}

interface Vector {
  name: string;
  /** Routes the C# test to the right `EnvelopeCodec` parse method. */
  kind:
    | "meta"
    | "streamData"
    | "eventMsg"
    | "commandRequest"
    | "commandResponse"
    | "errorMsg"
    | "subscribe"
    | "unsubscribe";
  json: string;
}

const metaNormal: Meta = {
  source: "vessel-1",
  validAt: 120.5,
  seq: 7,
  deliveredAt: 122.75,
  vantage: "KSC",
  quality: Quality.OnRails,
  active: true,
  staleness: Staleness.Fresh,
  timelineEpoch: 0,
  confidence: 0.87,
};

// `confidence` is optional — omitted here (not present as `undefined`) to
// exercise the "optional field entirely absent from the wire" case, which
// `JSON.stringify` already handles for free (an absent property never
// appears), and which `EnvelopeCodec`'s writer must replicate deliberately
// (it does NOT write `"confidence":null`).
const metaNoConfidence: Meta = {
  source: "vessel-1",
  validAt: 0,
  seq: 1,
  deliveredAt: 0,
  vantage: "KSC",
  quality: Quality.Loaded,
  active: false,
  staleness: Staleness.HeldStale,
  timelineEpoch: 3,
};

// The NaN/Infinity fixture case called for by Task 7: three of Meta's own
// numeric fields hit all three sentinel tokens at once.
const metaNonFinite: Meta = {
  source: "vessel-1",
  validAt: Number.NaN,
  seq: 42,
  deliveredAt: Number.POSITIVE_INFINITY,
  vantage: "KSC",
  quality: Quality.OnRails,
  active: true,
  staleness: Staleness.LastBeforeBlackout,
  timelineEpoch: 2,
  confidence: Number.NEGATIVE_INFINITY,
};

const streamDataNumber: StreamData<number> = {
  type: "stream-data",
  topic: "vessel.altitude",
  payload: 70432.125,
  meta: metaNormal,
};

const streamDataObject: StreamData<Record<string, unknown>> = {
  type: "stream-data",
  topic: "vessel.status",
  payload: { landed: false, stage: 3, tags: ["prograde", "warp"], note: null },
  meta: metaNormal,
};

// NaN/Infinity through the FREE-FORM payload path, not just Meta's
// fixed-schema fields — proves the policy is applied uniformly, not just
// hard-coded for Meta.
const streamDataNanPayload: StreamData<Record<string, unknown>> = {
  type: "stream-data",
  topic: "vessel.orbit.eccentricAnomaly",
  payload: { eccentricAnomaly: Number.NaN, apoapsis: Number.POSITIVE_INFINITY },
  meta: metaNoConfidence,
};

const eventMsg: EventMsg = {
  type: "event",
  topic: "vessel.stage",
  name: "stage-separated",
  meta: metaNormal,
};

const commandRequest: CommandRequest<Record<string, unknown>> = {
  type: "command-request",
  requestId: "req-1",
  command: "deploy",
  label: "",
  args: { part: "solar-panel-1" },
  sentAt: 100,
};

const commandResponse: CommandResponse<Record<string, unknown>> = {
  type: "command-response",
  requestId: "req-1",
  result: { ok: true, deployedAt: 101.5 },
  meta: metaNormal,
};

const errorMsgFull: ErrorMsg = {
  type: "error",
  requestId: "req-2",
  topic: "vessel.altitude",
  code: "UNREACHABLE",
  message: "node unreachable from vantage",
};

// requestId/topic both optional — omitted here (a server-level error not
// tied to a specific request or topic).
const errorMsgMinimal: ErrorMsg = {
  type: "error",
  code: "INTERNAL",
  message: "unexpected server error",
};

const subscribe: Subscribe = { type: "subscribe", topic: "vessel.altitude" };
const unsubscribe: Unsubscribe = {
  type: "unsubscribe",
  topic: "vessel.altitude",
};

const vectors: Vector[] = [
  { name: "meta-normal", kind: "meta", json: safeStringify(metaNormal) },
  {
    name: "meta-no-confidence",
    kind: "meta",
    json: safeStringify(metaNoConfidence),
  },
  {
    name: "meta-nan-infinity",
    kind: "meta",
    json: safeStringify(metaNonFinite),
  },
  {
    name: "stream-data-number",
    kind: "streamData",
    json: safeStringify(streamDataNumber),
  },
  {
    name: "stream-data-object",
    kind: "streamData",
    json: safeStringify(streamDataObject),
  },
  {
    name: "stream-data-nan-payload",
    kind: "streamData",
    json: safeStringify(streamDataNanPayload),
  },
  { name: "event-msg", kind: "eventMsg", json: safeStringify(eventMsg) },
  {
    name: "command-request",
    kind: "commandRequest",
    json: safeStringify(commandRequest),
  },
  {
    name: "command-response",
    kind: "commandResponse",
    json: safeStringify(commandResponse),
  },
  {
    name: "error-msg-full",
    kind: "errorMsg",
    json: safeStringify(errorMsgFull),
  },
  {
    name: "error-msg-minimal",
    kind: "errorMsg",
    json: safeStringify(errorMsgMinimal),
  },
  { name: "subscribe", kind: "subscribe", json: safeStringify(subscribe) },
  {
    name: "unsubscribe",
    kind: "unsubscribe",
    json: safeStringify(unsubscribe),
  },
];

writeFileSync(OUT_FILE, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`golden-fixtures -> ${OUT_FILE} (${vectors.length} vectors)`);
