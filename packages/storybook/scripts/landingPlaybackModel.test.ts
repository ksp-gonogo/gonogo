import { describe, expect, it } from "vitest";
import { integrate } from "../../components/scripts/landingDescentModel";
import { MAX_STEP_METERS, playbackOf } from "./landingPlaybackModel";

describe("a safe landing story", () => {
  const frames = integrate({ crash: false });
  const { played, streamEnds } = playbackOf(frames, false);

  it("is played through to the touchdown, and the stream carries on", () => {
    expect(played[0]).toEqual(frames[0]);
    expect(played[played.length - 1].landed).toBe(true);
    expect(streamEnds).toBe(false);
  });
});

describe("a crash story", () => {
  const frames = integrate({ crash: true });
  const { played, streamEnds } = playbackOf(frames, true);

  it("is played to the last frame above the ground, then the stream ends", () => {
    expect(played[played.length - 1].aglMeters).toBeGreaterThan(0);
    expect(played.length).toBeGreaterThanOrEqual(frames.length - 1);
    expect(streamEnds).toBe(true);
  });
});

describe("the last stretch of a descent", () => {
  it.each([
    ["crash", true],
    ["safe landing", false],
  ])("moves the craft a few metres at a time frame to frame in a %s, so it never jumps", (_name, crash) => {
    const { played } = playbackOf(integrate({ crash }), crash);
    for (let i = 1; i < played.length; i++) {
      if (played[i - 1].aglMeters > 1_000) continue;
      expect(
        Math.abs(played[i - 1].aglMeters - played[i].aglMeters),
        `step ${i}`,
      ).toBeLessThanOrEqual(MAX_STEP_METERS + 1e-9);
    }
  });

  it("keeps the descent's own frames, in order, among the ones it adds", () => {
    const frames = integrate({ crash: true });
    const { played } = playbackOf(frames, true);
    for (const f of frames.slice(0, -1)) {
      expect(played).toContainEqual(f);
    }
    for (let i = 1; i < played.length; i++) {
      expect(played[i].t).toBeGreaterThan(played[i - 1].t);
    }
  });
});
