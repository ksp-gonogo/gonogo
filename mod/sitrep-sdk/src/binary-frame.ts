import type { Meta, StreamBinary } from "./__generated__/contract";

/**
 * The BINARY LANE, read side: how a frame carrying opaque bytes is told apart
 * from the JSON every other frame on this socket is, and taken apart.
 *
 * The C# writer is `Sitrep.Core.Serialization.BinaryFrameCodec`, and
 * `Sitrep.Contract.BinaryLane` carries the full rationale. What matters here:
 *
 * ```
 * offset  size          field
 * 0       1             MAGIC (0x9E)
 * 1       1             LANE  (0x01 = stream-binary)
 * 2       2             u16 big-endian header length H
 * 4       H             UTF-8 JSON header, a StreamBinary
 * 4+H     sum(segments) the segments, concatenated, in declaration order
 * ```
 *
 * **This module is the whole dependency.** A third party can decode the lane
 * with the four lines the layout above describes and no gonogo package at all,
 * which is the point: tuning in must not require an SDK. This exists so
 * consumers that DO have the SDK are not each writing their own, and so the two
 * ends of the format have exactly one place to drift apart at.
 */

/** First byte of every binary-lane frame. */
export const BINARY_LANE_MAGIC = 0x9e;

/** The one lane this version knows: a `stream-binary` delivery. */
export const BINARY_LANE_STREAM_BINARY = 0x01;

/** Magic + lane + the two length bytes. */
export const BINARY_LANE_PREFIX_BYTES = 4;

/**
 * One delivery off the binary lane, as a consumer wants it.
 *
 * The generated `StreamBinary` types `segments` as the LENGTH TABLE, which is
 * what travels in the header; by the time a frame is decoded those lengths have
 * been spent and what is left is the bytes, so the field is re-typed rather
 * than duplicated. Derived from the generated type rather than restated, so a
 * field added to the header cannot go missing here.
 *
 * `Uint8Array`, deliberately, and never a bare `ArrayBuffer`. The PeerJS radio
 * path carries a written-down scar from exactly that substitution
 * (`packages/app/src/commcast/radio/wire.ts`): a decoder takes either happily,
 * so the defect is invisible until something INDEXES the bytes, and then every
 * element reads `undefined`.
 */
export type StreamBinaryMessage = Omit<StreamBinary, "segments"> & {
  segments: Uint8Array[];
};

/**
 * Why a frame could not be read. Never an empty delivery: a caller handed zero
 * segments must be able to read that as "the producer had nothing to say",
 * which is a different fact from "the frame arrived broken".
 *
 * Every arm carries a `reason`, `not-binary` included, so a caller can log the
 * failure without first narrowing on `kind`. `kind` is for BEHAVIOUR (fall back
 * to text, or drop and warn); `reason` is for the human either way.
 */
export type BinaryFrameFailure =
  /** Not a binary-lane frame at all. The caller should treat it as text. */
  | { kind: "not-binary"; reason: string }
  /** A lane byte this build does not know: refuse it, never fall back to text. */
  | { kind: "unknown-lane"; lane: number; reason: string }
  /** Well-formed prefix, unreadable frame. */
  | { kind: "malformed"; reason: string };

export type BinaryFrameResult =
  | { ok: true; message: StreamBinaryMessage }
  | ({ ok: false } & BinaryFrameFailure);

/**
 * Whether these bytes lead with the magic. The only question a decode seam asks
 * before it commits to a lane, and the reason a JSON frame never reaches this
 * module's parser: every frame the protocol writes as text opens with `{`
 * (0x7B), and 0x80-0xBF is the UTF-8 continuation range, which cannot lead a
 * UTF-8 document at all.
 */
export function isBinaryFrame(bytes: Uint8Array): boolean {
  return bytes.length >= 1 && bytes[0] === BINARY_LANE_MAGIC;
}

const HEADER_TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

/**
 * Take one frame apart, or say why it could not be.
 *
 * The segments are VIEWS onto the frame's own buffer (`subarray`, not `slice`),
 * so decoding a batch of ten costs no copies. That is safe here and would not
 * be everywhere: the caller owns the buffer, having just received it, and
 * nothing on this path writes back into it. A consumer that intends to retain a
 * segment past the frame's own lifetime should copy it.
 */
export function decodeBinaryFrame(bytes: Uint8Array): BinaryFrameResult {
  if (!isBinaryFrame(bytes)) {
    return {
      ok: false,
      kind: "not-binary",
      reason: "frame does not lead with the binary-lane magic byte",
    };
  }
  if (bytes.length < BINARY_LANE_PREFIX_BYTES) {
    return {
      ok: false,
      kind: "malformed",
      reason: `frame is shorter than the ${BINARY_LANE_PREFIX_BYTES}-byte binary-lane prefix`,
    };
  }

  const lane = bytes[1];
  if (lane !== BINARY_LANE_STREAM_BINARY) {
    /*
     * Named, and never decoded as text. Handing an unknown lane's bytes to a
     * UTF-8 decoder produces replacement characters that then fail JSON
     * parsing somewhere else entirely, by which point the one fact worth
     * reporting (this build does not know this lane) has been thrown away.
     */
    return {
      ok: false,
      kind: "unknown-lane",
      lane,
      reason: `unknown binary lane 0x${lane.toString(16).toUpperCase().padStart(2, "0")}`,
    };
  }

  const headerLength = (bytes[2] << 8) | bytes[3];
  const available = bytes.length - BINARY_LANE_PREFIX_BYTES;
  if (headerLength > available) {
    return {
      ok: false,
      kind: "malformed",
      reason: `header claims ${headerLength} bytes, only ${available} remain in the frame`,
    };
  }

  const headerText = HEADER_TEXT_DECODER.decode(
    bytes.subarray(
      BINARY_LANE_PREFIX_BYTES,
      BINARY_LANE_PREFIX_BYTES + headerLength,
    ),
  );

  let header: {
    type?: unknown;
    topic?: unknown;
    segments?: unknown;
    meta?: unknown;
  };
  try {
    header = JSON.parse(headerText);
  } catch (error) {
    return {
      ok: false,
      kind: "malformed",
      reason: `header is not readable JSON: ${String(error)}`,
    };
  }

  if (header.type !== "stream-binary") {
    return {
      ok: false,
      kind: "malformed",
      reason: `header type is ${JSON.stringify(header.type)}, not "stream-binary"`,
    };
  }
  if (typeof header.topic !== "string") {
    return { ok: false, kind: "malformed", reason: "header has no topic" };
  }
  if (!Array.isArray(header.segments)) {
    return {
      ok: false,
      kind: "malformed",
      reason: "header has no segment table",
    };
  }
  if (typeof header.meta !== "object" || header.meta === null) {
    return { ok: false, kind: "malformed", reason: "header has no meta" };
  }

  let declared = 0;
  for (const length of header.segments) {
    /* A byte count, so a fractional or negative one is not a short frame: it
       is a producer that has lost track of its own buffer, and computing an
       offset from it would read whatever the next frame's bytes happen to be. */
    if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
      return {
        ok: false,
        kind: "malformed",
        reason: `segment length must be a non-negative integer, got ${String(length)}`,
      };
    }
    declared += length;
  }

  const payloadStart = BINARY_LANE_PREFIX_BYTES + headerLength;
  const payloadAvailable = bytes.length - payloadStart;
  // Exact, in both directions. Short is truncation; long means the header and
  // the bytes disagree about what was sent, and delivering the prefix that
  // does line up would hand a listener a fragment of a transmission with
  // nothing to say it is one.
  if (declared !== payloadAvailable) {
    return {
      ok: false,
      kind: "malformed",
      reason: `segment table sums to ${declared} bytes, frame carries ${payloadAvailable}`,
    };
  }

  const segments: Uint8Array[] = [];
  let cursor = payloadStart;
  for (const length of header.segments as number[]) {
    segments.push(bytes.subarray(cursor, cursor + length));
    cursor += length;
  }

  return {
    ok: true,
    message: {
      type: "stream-binary",
      topic: header.topic,
      meta: header.meta as Meta,
      segments,
    },
  };
}

/**
 * The bytes of a frame, whatever shape the socket handed them over in.
 *
 * `binaryType = "arraybuffer"` gets an `ArrayBuffer`; a test harness or a
 * relay may hand over a view already. A `Blob` is not handled and must not be:
 * reading one is asynchronous, which reorders the stream.
 */
export function frameBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
