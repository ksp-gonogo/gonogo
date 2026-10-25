import { type Packable, pack, unpack } from "peerjs-js-binarypack";

/**
 * The largest data channel message either side sends. Browsers disagree on
 * the largest message they will take whole (Firefox to Chrome cuts at
 * 16 KiB), so a message beyond this is split.
 */
export const MAX_FRAME_BYTES = 16_000;

const WHOLE = 0;
const PIECE = 1;
/** Kind, message id (u32), piece index (u16), piece count (u16). */
const PIECE_HEADER = 9;

let nextMessageId = 1;

/**
 * One message as the data channel frames that carry it to the endpoint's
 * other side. The payload is packed with the same serializer PeerJS uses
 * for a binary data connection, so a message reads the same whichever path
 * it took. A message that packs to a Blob cannot be sent synchronously, and
 * the peer protocol never carries one.
 */
export function encodeFrames(message: Packable): Uint8Array<ArrayBuffer>[] {
  const packed = pack(message);
  if (!(packed instanceof ArrayBuffer)) {
    throw new Error("a peer message cannot carry a Blob");
  }
  const body = new Uint8Array(packed);
  if (body.byteLength + 1 <= MAX_FRAME_BYTES) {
    const frame = new Uint8Array(body.byteLength + 1);
    frame[0] = WHOLE;
    frame.set(body, 1);
    return [frame];
  }
  const room = MAX_FRAME_BYTES - PIECE_HEADER;
  const count = Math.ceil(body.byteLength / room);
  const id = nextMessageId++ >>> 0;
  const frames: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < count; i++) {
    const part = body.subarray(i * room, (i + 1) * room);
    const frame = new Uint8Array(PIECE_HEADER + part.byteLength);
    const view = new DataView(frame.buffer);
    view.setUint8(0, PIECE);
    view.setUint32(1, id);
    view.setUint16(5, i);
    view.setUint16(7, count);
    frame.set(part, PIECE_HEADER);
    frames.push(frame);
  }
  return frames;
}

/** Reads frames from `encodeFrames` back into messages, holding pieces until the last arrives. */
export class FrameReader {
  private readonly partial = new Map<number, Uint8Array[]>();
  /** Called for every piece of a split message, so a slow large message still shows the other side is there. */
  onPiece: ((bytes: number) => void) | null = null;

  push(frame: Uint8Array): unknown {
    if (frame.byteLength === 0) return undefined;
    if (frame[0] === WHOLE) return this.read(frame.subarray(1));
    if (frame[0] !== PIECE || frame.byteLength < PIECE_HEADER) return undefined;
    this.onPiece?.(frame.byteLength);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const id = view.getUint32(1);
    const index = view.getUint16(5);
    const count = view.getUint16(7);
    const parts = this.partial.get(id) ?? new Array<Uint8Array>(count);
    parts[index] = frame.slice(PIECE_HEADER);
    this.partial.set(id, parts);
    for (let i = 0; i < count; i++) if (!parts[i]) return undefined;
    this.partial.delete(id);
    const size = parts.reduce((n, p) => n + p.byteLength, 0);
    const body = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      body.set(p, at);
      at += p.byteLength;
    }
    return this.read(body);
  }

  private read(body: Uint8Array): unknown {
    try {
      const copy = body.slice();
      return unpack(copy.buffer);
    } catch {
      return undefined;
    }
  }
}
