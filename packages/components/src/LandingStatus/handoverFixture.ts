import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The `__render_handover__` set, read and CHECKED on the way in.
 *
 * Extracted when a second reader appeared (`carried-altitude.test.tsx`): the
 * generator writes these files, so the shape is ours on both sides, and two
 * readers each asserting their own version of it out of `unknown` is how the
 * two would come to disagree about what a fixture is.
 *
 * Validated rather than asserted, for the reason the first reader gave: a
 * fixture that has drifted out of shape must fail HERE, naming itself, and not
 * two frames later as an unreadable `expectedBasis`. Built field by field off
 * `isRecord` rather than with one cast at the top, because an assertion out of
 * `unknown` is what `unknown-cast.test.ts` is for and the whole value of a
 * check here is that it looked.
 */

export const HANDOVER_FIXTURES_DIR = join(__dirname, "__render_handover__");

export interface StreamEmit {
  channel: string;
  value: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface HandoverFixture {
  _meta: {
    scenario: string;
    expectedBasis: string;
    /** Present on a `declined` frame; see the generator's own `Frame.decline`. */
    expectedDecline?: { reason: string; input: string };
  };
  _stream: {
    carriedChannels: string[];
    pinnedUt: number;
    emits: StreamEmit[];
  };
}

/** A type predicate, so every property read below narrows rather than asserts. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseFixture(file: string, raw: unknown): HandoverFixture {
  const bad = (why: string): never => {
    throw new Error(`${file}: ${why}`);
  };
  if (!isRecord(raw)) return bad("not an object");
  const meta = raw._meta;
  const stream = raw._stream;
  if (!isRecord(meta)) return bad("no _meta");
  if (!isRecord(stream)) return bad("no _stream");
  const { scenario, expectedBasis, expectedDecline } = meta;
  const { carriedChannels, pinnedUt, emits } = stream;
  if (typeof scenario !== "string")
    return bad("_meta.scenario is not a string");
  if (typeof expectedBasis !== "string") {
    return bad("_meta.expectedBasis is not a string");
  }
  if (!Array.isArray(carriedChannels) || !Array.isArray(emits)) {
    return bad("_stream.carriedChannels and .emits must both be arrays");
  }
  if (typeof pinnedUt !== "number") {
    return bad("_stream.pinnedUt is not a number");
  }
  let decline: { reason: string; input: string } | undefined;
  if (expectedBasis === "declined") {
    if (!isRecord(expectedDecline)) {
      return bad("a declined frame needs _meta.expectedDecline");
    }
    const { reason, input } = expectedDecline;
    if (typeof reason !== "string" || typeof input !== "string") {
      return bad("_meta.expectedDecline needs a string reason and input");
    }
    decline = { reason, input };
  }
  const parsedEmits: StreamEmit[] = emits.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.channel !== "string") {
      return bad("an emit has no channel");
    }
    if (!isRecord(entry.value)) return bad("an emit has no value object");
    return {
      channel: entry.channel,
      value: entry.value,
      meta: isRecord(entry.meta) ? entry.meta : undefined,
    };
  });
  return {
    _meta: { scenario, expectedBasis, expectedDecline: decline },
    _stream: {
      carriedChannels: carriedChannels.map(String),
      pinnedUt,
      emits: parsedEmits,
    },
  };
}

/** One frame of the set, by file name. */
export function loadHandoverFixture(file: string): HandoverFixture {
  return parseFixture(
    file,
    JSON.parse(readFileSync(join(HANDOVER_FIXTURES_DIR, file), "utf8")),
  );
}

/**
 * Every frame, in order.
 *
 * Walks the DIRECTORY rather than a list, so a frame added to the set is
 * covered without being remembered anywhere.
 */
export function loadHandoverFixtures(): HandoverFixture[] {
  return readdirSync(HANDOVER_FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map(loadHandoverFixture);
}
