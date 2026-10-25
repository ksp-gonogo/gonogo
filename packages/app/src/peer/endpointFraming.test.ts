import { describe, expect, it } from "vitest";
import { encodeFrames, FrameReader, MAX_FRAME_BYTES } from "./endpointFraming";

describe("endpoint framing", () => {
  it("carries a small message in one frame and reads it back", () => {
    const frames = encodeFrames({ type: "hello", version: "1.2.3" });
    expect(frames).toHaveLength(1);
    const reader = new FrameReader();
    expect(reader.push(frames[0] as Uint8Array)).toEqual({
      type: "hello",
      version: "1.2.3",
    });
  });

  it("keeps an ArrayBuffer an ArrayBuffer, as PeerJS's binary serialization does", () => {
    const bytes = new Uint8Array([1, 2, 3, 250]).buffer;
    const reader = new FrameReader();
    const [frame] = encodeFrames({ type: "bundle", data: bytes });
    const data: unknown = Reflect.get(
      Object(reader.push(frame as Uint8Array)),
      "data",
    );
    if (!(data instanceof ArrayBuffer))
      throw new Error("data came back as another type");
    expect([...new Uint8Array(data)]).toEqual([1, 2, 3, 250]);
  });

  it("splits a large message into frames no bigger than the limit and puts it back together", () => {
    const big = new Uint8Array(MAX_FRAME_BYTES * 3 + 17);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    const frames = encodeFrames({ type: "bundle", data: big.buffer });
    expect(frames.length).toBeGreaterThan(3);
    for (const f of frames)
      expect(f.byteLength).toBeLessThanOrEqual(MAX_FRAME_BYTES);

    const reader = new FrameReader();
    const pieces: number[] = [];
    reader.onPiece = () => pieces.push(1);
    const results = frames.map((f) => reader.push(f));
    expect(results.slice(0, -1).every((r) => r === undefined)).toBe(true);
    const data: unknown = Reflect.get(Object(results.at(-1)), "data");
    if (!(data instanceof ArrayBuffer))
      throw new Error("data came back as another type");
    expect(new Uint8Array(data)).toEqual(big);
    expect(pieces).toHaveLength(frames.length);
  });

  it("keeps two large messages apart when their frames interleave", () => {
    const a = encodeFrames({
      n: "a",
      data: new Uint8Array(MAX_FRAME_BYTES * 2).fill(1).buffer,
    });
    const b = encodeFrames({
      n: "b",
      data: new Uint8Array(MAX_FRAME_BYTES * 2).fill(2).buffer,
    });
    const reader = new FrameReader();
    const out: unknown[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      for (const f of [a[i], b[i]]) {
        if (!f) continue;
        const got = reader.push(f);
        if (got !== undefined) out.push(Reflect.get(Object(got), "n"));
      }
    }
    expect(out.sort()).toEqual(["a", "b"]);
  });

  it("ignores a frame it cannot read", () => {
    const reader = new FrameReader();
    expect(reader.push(new Uint8Array([9, 9, 9]))).toBeUndefined();
    expect(reader.push(new Uint8Array([]))).toBeUndefined();
  });
});
