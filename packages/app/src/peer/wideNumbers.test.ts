import { util } from "peerjs";
import { describe, expect, it } from "vitest";
import { decodeWideNumbers, encodeWideNumbers } from "./wideNumbers";

/** Stock Kerbol system figures as the mod writes them, whole numbers well past 2^64. */
function bodiesFrame() {
  return {
    type: "stream-data" as const,
    topic: "system.bodies",
    payload: {
      bodies: [
        {
          name: "Sun",
          index: 0,
          parentIndex: null,
          mass: 1.7565459e28,
          radius: 261600000,
          sphereOfInfluence: Infinity,
        },
        {
          name: "Kerbin",
          index: 1,
          parentIndex: 0,
          mass: 5.2915158e22,
          radius: 600000,
          gravParameter: 3.5316e12,
        },
      ],
    },
  };
}

describe("numbers the PeerJS packer refuses", () => {
  it("throws on a real system.bodies payload, which is what stopped a station receiving it", () => {
    expect(() =>
      util.pack({ type: "sitrep-frame", message: bodiesFrame() }),
    ).toThrow("Invalid integer");
  });

  it("packs once encoded, and the far side restores the exact values", async () => {
    const original = bodiesFrame();
    const wire = encodeWideNumbers(original);

    const packed = await util.pack({ type: "sitrep-frame", message: wire });
    const received = (await util.unpack(packed as ArrayBuffer)) as {
      message: unknown;
    };

    expect(decodeWideNumbers(received.message)).toEqual(original);
  });

  it("leaves a frame with nothing unpackable as the same object, and never mutates the original", () => {
    const small = {
      topic: "vessel.orbit",
      payload: { sma: 1005000, ecc: 0.005 },
    };
    expect(encodeWideNumbers(small)).toBe(small);

    const original = bodiesFrame();
    encodeWideNumbers(original);
    expect(original.payload.bodies[1].mass).toBe(5.2915158e22);
  });
});
