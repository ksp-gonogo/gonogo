import { describe, expect, it } from "vitest";
import { buildMissionRecord } from "./buildMissionRecord";

function frame(validAt: number, deliveredAt: number): string {
  return JSON.stringify({
    type: "stream-data",
    topic: "vessel.flight",
    payload: {},
    meta: { validAt, deliveredAt },
  });
}

describe("buildMissionRecord", () => {
  it("keeps when the samples were valid apart from when their frames arrived", () => {
    // Recorded across a four second delay: what arrives at 100 was true at 96.
    const record = buildMissionRecord({
      vesselName: "Kerbal X",
      launchedAt: 1,
      fixture: { frames: [frame(96, 100), frame(126, 130), frame(156, 160)] },
    });

    expect(record?.meta).toMatchObject({
      firstFrameUt: 100,
      lastFrameUt: 160,
      firstValidUt: 96,
      lastValidUt: 156,
    });
  });

  it("states no valid-time span for frames that carry none", () => {
    const record = buildMissionRecord({
      vesselName: "Kerbal X",
      launchedAt: 1,
      fixture: {
        frames: [JSON.stringify({ meta: { deliveredAt: 100 } })],
      },
    });

    expect(record?.meta.firstFrameUt).toBe(100);
    expect(record?.meta).not.toHaveProperty("firstValidUt");
    expect(record?.meta).not.toHaveProperty("lastValidUt");
  });
});
