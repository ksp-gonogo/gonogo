import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Meta } from "./__generated__/contract";
import {
  BINARY_LANE_MAGIC,
  BINARY_LANE_PREFIX_BYTES,
  BINARY_LANE_STREAM_BINARY,
  decodeBinaryFrame,
  frameBytes,
  isBinaryFrame,
} from "./binary-frame";

/**
 * The client half of the binary lane, held against the SAME layout the C#
 * writer produces. The conformance itself is asserted in
 * `mod/Sitrep.Core.Tests/BinaryFrameCodecTests.cs` (a round trip through the
 * real transport); what this file owns is the reading of a frame and, more
 * importantly, the refusal of one that is wrong.
 *
 * The frames here are BUILT BY HAND rather than by calling an encoder from this
 * module, deliberately. There is no encoder here to call: the client never
 * writes this lane, so a test that round-tripped through a local encoder would
 * be checking this file against itself and would agree with a wrong layout
 * forever. Building the bytes from the documented offsets is the only version
 * of this test that can disagree with the C#.
 */

const META: Meta = {
  source: "radio",
  validAt: 1000.25,
  seq: 42,
  deliveredAt: 1030.25,
  vantage: "ksc",
  quality: 1,
  active: true,
  staleness: 0,
  timelineEpoch: 3,
};

function buildFrame(
  header: unknown,
  segments: Uint8Array[],
  options: { lane?: number; magic?: number; headerLength?: number } = {},
): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const payloadBytes = segments.reduce((sum, s) => sum + s.byteLength, 0);
  const frame = new Uint8Array(
    BINARY_LANE_PREFIX_BYTES + headerBytes.byteLength + payloadBytes,
  );
  const declaredHeaderLength = options.headerLength ?? headerBytes.byteLength;
  frame[0] = options.magic ?? BINARY_LANE_MAGIC;
  frame[1] = options.lane ?? BINARY_LANE_STREAM_BINARY;
  frame[2] = (declaredHeaderLength >> 8) & 0xff;
  frame[3] = declaredHeaderLength & 0xff;
  frame.set(headerBytes, BINARY_LANE_PREFIX_BYTES);
  let cursor = BINARY_LANE_PREFIX_BYTES + headerBytes.byteLength;
  for (const segment of segments) {
    frame.set(segment, cursor);
    cursor += segment.byteLength;
  }
  return frame;
}

function wellFormed(segments: Uint8Array[]): Uint8Array {
  return buildFrame(
    {
      type: "stream-binary",
      topic: "radio.rx.v-1",
      segments: segments.map((s) => s.byteLength),
      meta: META,
    },
    segments,
  );
}

const SEGMENTS = [
  new Uint8Array([0x00, 0x01, 0x02, 0xff]),
  new Uint8Array([0x9e, 0x7b, 0x00]),
  new Uint8Array([0xaa]),
];

describe("decodeBinaryFrame", () => {
  it("reads the header and every segment byte-identically", () => {
    const result = decodeBinaryFrame(wellFormed(SEGMENTS));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.type).toBe("stream-binary");
    expect(result.message.topic).toBe("radio.rx.v-1");
    expect(result.message.segments).toHaveLength(3);
    for (const [i, segment] of SEGMENTS.entries()) {
      expect(Array.from(result.message.segments[i])).toEqual(
        Array.from(segment),
      );
    }
  });

  it("carries the same Meta a JSON frame would", () => {
    const result = decodeBinaryFrame(wellFormed(SEGMENTS));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.meta).toEqual(META);
  });

  /**
   * `Uint8Array`, never a bare `ArrayBuffer`, and asserted rather than assumed.
   * The PeerJS radio path carries a written-down scar from exactly this
   * substitution: a decoder takes either happily, so the defect is invisible
   * until something INDEXES the bytes and every element reads `undefined`.
   */
  it("hands back indexable Uint8Arrays, not ArrayBuffers", () => {
    const result = decodeBinaryFrame(wellFormed(SEGMENTS));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const segment of result.message.segments) {
      expect(segment).toBeInstanceOf(Uint8Array);
      expect(typeof segment[0]).toBe("number");
    }
  });

  /**
   * PLANTED CONTROL. Every frame the protocol writes as text opens with `{`,
   * and the discriminator's whole claim is that none of them can be mistaken
   * for a binary one. Checked against realistic envelope JSON rather than a
   * bare brace.
   */
  it("does not mistake an ordinary JSON envelope for a binary frame", () => {
    const envelopes = [
      JSON.stringify({
        type: "stream-data",
        topic: "vessel.state",
        payload: { altitude: 1234.5 },
        meta: META,
      }),
      JSON.stringify({
        type: "event",
        topic: "vessel.state",
        name: "subscribed",
        meta: META,
      }),
      JSON.stringify({ type: "error", code: "unknown-topic", message: "no" }),
    ];

    for (const json of envelopes) {
      const bytes = new TextEncoder().encode(json);
      expect(isBinaryFrame(bytes)).toBe(false);
      const result = decodeBinaryFrame(bytes);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("not-binary");
    }
  });

  /**
   * PLANTED CONTROL, and the reason the lane byte exists. An unknown lane must
   * be refused BY NAME and never fall through to a UTF-8 decoder: doing so
   * turns compressed bytes into replacement characters that then fail JSON
   * parsing somewhere else, having discarded the one fact worth reporting.
   */
  it("refuses an unknown lane by name", () => {
    const frame = wellFormed(SEGMENTS);
    frame[1] = 0x7f;

    const result = decodeBinaryFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("unknown-lane");
    expect(result.reason).toContain("unknown binary lane 0x7F");
  });

  /**
   * PLANTED CONTROL for absence discipline. The temptation this rules out is
   * returning the segments that DID arrive whole, which hands a listener a
   * fragment of a transmission with nothing to say it is one.
   */
  it("treats a truncated frame as unread rather than partially delivered", () => {
    const frame = wellFormed(SEGMENTS);
    for (let lost = 1; lost <= 4; lost++) {
      const result = decodeBinaryFrame(frame.subarray(0, frame.length - lost));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("malformed");
      expect(result.reason).toContain("segment table sums to");
    }
  });

  it("treats a frame longer than its segment table as unread", () => {
    const frame = wellFormed(SEGMENTS);
    const overlong = new Uint8Array(frame.length + 1);
    overlong.set(frame);

    const result = decodeBinaryFrame(overlong);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("segment table sums to");
  });

  /**
   * Zero segments is LEGAL and means "this producer had nothing to say this
   * tick". The pairing with the truncation test above is the real assertion:
   * same empty segment list, opposite verdict.
   */
  it("accepts a frame with zero segments as a real delivery", () => {
    const result = decodeBinaryFrame(wellFormed([]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.segments).toEqual([]);
    expect(result.message.topic).toBe("radio.rx.v-1");
  });

  it("refuses a header length that runs past the end of the frame", () => {
    const frame = buildFrame(
      {
        type: "stream-binary",
        topic: "t",
        segments: [1],
        meta: META,
      },
      [new Uint8Array([1])],
      { headerLength: 0xffff },
    );

    const result = decodeBinaryFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("header claims");
  });

  it("refuses a segment length that is not a byte count", () => {
    for (const bad of [-4, 2.5, "8"]) {
      const frame = buildFrame(
        { type: "stream-binary", topic: "t", segments: [bad], meta: META },
        [],
      );
      const result = decodeBinaryFrame(frame);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("non-negative integer");
    }
  });

  it("refuses a header that is not a stream-binary document", () => {
    const frame = buildFrame(
      { type: "stream-data", topic: "t", segments: [], meta: META },
      [],
    );
    const result = decodeBinaryFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('not "stream-binary"');
  });

  it("refuses a frame shorter than the prefix", () => {
    const result = decodeBinaryFrame(
      new Uint8Array([BINARY_LANE_MAGIC, BINARY_LANE_STREAM_BINARY]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("shorter than the");
  });
});

describe("frameBytes", () => {
  it("reads an ArrayBuffer and a view to the same bytes", () => {
    const source = new Uint8Array([1, 2, 3, 4, 5]);
    expect(Array.from(frameBytes(source.buffer as ArrayBuffer))).toEqual([
      1, 2, 3, 4, 5,
    ]);
    // A view with a non-zero offset is the case a naive `new Uint8Array(v.buffer)`
    // gets wrong, silently reading the whole backing buffer instead of the view.
    expect(Array.from(frameBytes(source.subarray(2)))).toEqual([3, 4, 5]);
  });
});

/**
 * The cross-language pin, and the only assertion in this file whose bytes this
 * repo's TypeScript did not write.
 *
 * Everything above builds a frame from the documented offsets, which is a
 * second transcription of the same layout description the C# writer was
 * transcribed from: two transcriptions agree with each other forever,
 * including when both are wrong. These frames came out of the real
 * `Sitrep.Core.Serialization.BinaryFrameCodec`, generated by
 * `mod/Sitrep.Core.Tests/BinaryFrameFixtureTests.cs` and committed as bytes, so
 * a change to either end that the other did not follow shows up here.
 */
describe("the frames the C# writer actually produces", () => {
  interface FixtureCase {
    name: string;
    topic: string;
    frameBase64: string;
    segmentsBase64: string[];
  }

  /* Narrowed rather than asserted: a golden fixture that has drifted out of
     shape fails here, naming the case, instead of surfacing as an unrelated
     assertion inside whichever test reads the missing field. */
  function isFixtureCase(value: unknown): value is FixtureCase {
    return (
      typeof value === "object" &&
      value !== null &&
      "name" in value &&
      typeof value.name === "string" &&
      "topic" in value &&
      typeof value.topic === "string" &&
      "frameBase64" in value &&
      typeof value.frameBase64 === "string" &&
      "segmentsBase64" in value &&
      Array.isArray(value.segmentsBase64) &&
      value.segmentsBase64.every((entry) => typeof entry === "string")
    );
  }

  function readCases(json: unknown): FixtureCase[] {
    if (typeof json !== "object" || json === null || !("cases" in json)) {
      throw new Error('golden-fixtures/binary-frame.json: no "cases" key');
    }
    const { cases } = json;
    if (!Array.isArray(cases)) {
      throw new Error(
        'golden-fixtures/binary-frame.json: "cases" is not an array',
      );
    }
    return cases.map((entry, index) => {
      if (!isFixtureCase(entry)) {
        throw new Error(
          `golden-fixtures/binary-frame.json: case ${index} is not a FixtureCase`,
        );
      }
      return entry;
    });
  }

  const fixture = {
    cases: readCases(
      JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL("../../golden-fixtures/binary-frame.json", import.meta.url),
          ),
          "utf8",
        ),
      ),
    ),
  };

  const fromBase64 = (value: string): Uint8Array =>
    Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

  const toBase64 = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes));

  it("has cases to check, so an emptied fixture cannot pass vacuously", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(4);
  });

  it.each(
    fixture.cases.map((c) => [c.name, c] as const),
  )("decodes the committed %s frame", (_name, testCase) => {
    const result = decodeBinaryFrame(fromBase64(testCase.frameBase64));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.topic).toBe(testCase.topic);
    expect(result.message.segments.map(toBase64)).toEqual(
      testCase.segmentsBase64,
    );
  });
});
