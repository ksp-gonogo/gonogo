import type { Meta, StreamBinary } from "./__generated__/contract";

/**
 * The BINARY LANE, read side: how a frame carrying opaque bytes is told apart
 * from the JSON every other frame on this socket is, and taken apart.
 *
 * The C# writer is `Sitrep.Contract.Serialization.BinaryFrameCodec`, and
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

/**
 * First byte of every binary-lane frame.
 *
 * @category Binary lane
 */
export const BINARY_LANE_MAGIC = 0x9e;

/**
 * The lane byte of a `stream-binary` frame, the one lane there is.
 *
 * @category Binary lane
 *
 * @concept Binary lane
 * The binary lane is how the stream carries a payload that is opaque bytes,
 * such as radio audio, without encoding it as JSON. Every other server frame is
 * UTF-8 JSON and opens with `{`; a binary-lane frame opens with
 * {@link BINARY_LANE_MAGIC} instead, then a lane byte
 * ({@link BINARY_LANE_STREAM_BINARY}, the only lane defined), a two-byte header
 * length, a JSON {@link StreamBinary} header, and the payload as one or more
 * segments laid end to end.
 *
 * - it is wire level: a widget reading Topics never meets a binary frame. Only
 *   code that reads the socket itself does, and checks the first byte with
 *   {@link isBinaryFrame} before parsing anything
 * - its bytes are delayed like any value: the header carries the same meta as a
 *   JSON data frame, so a binary delivery observes the signal delay, the
 *   vantage and the timeline exactly as a JSON one does
 * - no segments is not no message: a frame with zero segments decodes
 *   successfully, while a frame whose segment lengths do not add up is refused
 *   with a reason ({@link BinaryFrameFailure}) and never replaced by an empty
 *   payload
 *
 * {@link decodeBinaryFrame} reads a frame into a {@link StreamBinaryMessage}.
 * What each segment means belongs to the Uplink that sends it.
 */
export const BINARY_LANE_STREAM_BINARY = 0x01;

/**
 * The length of a binary frame's fixed prefix, in bytes. A frame is laid out
 * as the magic byte, the lane byte, the header's length as a big-endian
 * unsigned 16-bit number, the header as UTF-8 JSON of that length, and then
 * the segments one after another, each as long as the header says.
 *
 * @category Binary lane
 */
export const BINARY_LANE_PREFIX_BYTES = 4;

/**
 * One binary frame, decoded: the fields of its {@link StreamBinary} header,
 * with `segments` holding the segments' bytes in place of their lengths. Each
 * segment is a `Uint8Array`.
 *
 * @category Binary lane
 */
export type StreamBinaryMessage = Omit<StreamBinary, "segments"> & {
  segments: Uint8Array[];
};

/**
 * Why a frame could not be decoded. Every case carries a `reason` to log;
 * branch on `kind` to decide what to do, such as reading the frame as text
 * instead. A frame with zero segments decodes successfully, as a producer with
 * nothing to send.
 *
 * @category Binary lane
 */
export type BinaryFrameFailure =
  /** Not a binary-lane frame at all. The caller should treat it as text. */
  | { kind: "not-binary"; reason: string }
  /** A lane byte this build does not know: refuse it, never fall back to text. */
  | { kind: "unknown-lane"; lane: number; reason: string }
  /** Well-formed prefix, unreadable frame. */
  | { kind: "malformed"; reason: string };

/**
 * What `decodeBinaryFrame` returns: the decoded message, or the reason the bytes
 * are not one.
 *
 * @category Binary lane
 */
export type BinaryFrameResult =
  | { ok: true; message: StreamBinaryMessage }
  | ({ ok: false } & BinaryFrameFailure);

/**
 * Whether `bytes` start with the binary frame's magic byte. A text frame never
 * does, since it starts with `{`.
 *
 * @category Binary lane
 */
export function isBinaryFrame(bytes: Uint8Array): boolean {
  return bytes.length >= 1 && bytes[0] === BINARY_LANE_MAGIC;
}

const HEADER_TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

/**
 * Decodes one binary frame, or says why it could not.
 *
 * Each segment is a view onto `bytes`, not a copy, so decoding is cheap. Copy a
 * segment you keep after `bytes` may be reused.
 *
 * @category Binary lane
 * @categoryDescription Binary lane
 * The stream's second lane, which carries bulk payloads as raw bytes instead of
 * JSON: how to tell a binary frame from a text one and read its header and
 * body. Only a client that handles the socket itself meets these.
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
 * The bytes of a frame, from an `ArrayBuffer` (a socket with
 * `binaryType = "arraybuffer"`) or a view. A `Blob` is not accepted: reading
 * one is asynchronous, which would put frames out of order.
 *
 * @category Binary lane
 */
export function frameBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
