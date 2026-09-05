import { describe, expect, it } from "vitest";
import { clipBytes, readClipChunk, SHORT_CLIP } from "./clips";
import type { RadioFrame } from "./wire";
import { radioFrameFromWire } from "./wire";

/**
 * The audio's shape after it has crossed a peer.
 *
 * Written from a MEASUREMENT rather than from the type: driving two real
 * screens at each other over the mesh, every chunk arrived at the far end as
 * an `ArrayBuffer`, and the first decoder to index one rather than hand it
 * straight to `EncodedAudioChunk` said so immediately. The declared type says
 * `Uint8Array` at both ends.
 */

function chunkFrame(bytes: Uint8Array | ArrayBuffer): RadioFrame {
  return {
    kind: "chunk",
    transmissionId: "t-1",
    authorStationKey: "station-a",
    seq: 0,
    ut: 1_000,
    bytes: bytes as Uint8Array,
  };
}

describe("radioFrameFromWire", () => {
  it("puts an ArrayBuffer of audio back into the shape the type promises", () => {
    const sent = clipBytes(SHORT_CLIP, 3);
    // Exactly what PeerJS delivers: the same six bytes, in an ArrayBuffer.
    const arrived = chunkFrame(sent.buffer.slice(0) as ArrayBuffer);

    const normalised = radioFrameFromWire(arrived);

    expect(normalised.kind).toBe("chunk");
    const bytes = (normalised as Extract<RadioFrame, { kind: "chunk" }>).bytes;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([...sent]);
    // The reading a consumer actually wanted, which an ArrayBuffer cannot give:
    // indexing one returns `undefined` and every byte-level check fails.
    expect(readClipChunk(bytes).index).toBe(3);
  });

  it("leaves audio that already arrived intact alone, without copying it", () => {
    const frame = chunkFrame(clipBytes(SHORT_CLIP, 0));

    // Identity, not equality: this runs fifty times a second per talker, and a
    // defensive copy per chunk is a cost paid on the path that was never broken.
    expect(radioFrameFromWire(frame)).toBe(frame);
  });

  it("leaves the envelope frames alone, which carry no audio at all", () => {
    const start: RadioFrame = {
      kind: "start",
      transmissionId: "t-1",
      authorStationKey: "station-a",
      transmission: {
        id: "t-1",
        to: ["ksc"],
        from: "vessel:near",
        authorStationKey: "station-a",
        authorName: "Pilot",
        authorSeat: "pilot",
        startedUt: 1_000,
        separationSeconds: 3,
      },
    };
    const end: RadioFrame = {
      kind: "end",
      transmissionId: "t-1",
      authorStationKey: "station-a",
      ut: 1_002,
    };

    expect(radioFrameFromWire(start)).toBe(start);
    expect(radioFrameFromWire(end)).toBe(end);
  });
});
