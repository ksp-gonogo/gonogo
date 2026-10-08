import { describe, expect, it } from "vitest";
import {
  KEYINGS,
  linkUp,
  PLAYBACK_SECONDS,
  signalQuality,
  speechChunks,
  spokenSeconds,
  staticLevel,
} from "./commsPlaybackModel";

describe("the comms timeline", () => {
  it("starts without a link, acquires it, loses it and gets it back", () => {
    expect([0, 1, 2, 9, 10, 14.5].map(linkUp)).toEqual([
      false,
      false,
      true,
      true,
      false,
      true,
    ]);
  });

  it("has no signal in the blackout and a full one before the fade", () => {
    expect(signalQuality(11)).toBe(0);
    expect(signalQuality(6)).toBe(1);
  });

  it("fades monotonically from the start of the fade to the blackout", () => {
    const fade = [7.6, 8.1, 8.6, 9.1, 9.4].map(signalQuality);
    for (let i = 1; i < fade.length; i++) {
      expect(fade[i]).toBeLessThan(fade[i - 1]);
    }
  });

  it("puts out the most hiss when the signal is gone", () => {
    expect(staticLevel(11)).toBeGreaterThan(staticLevel(6));
  });

  it("never lets a keying run into a blackout past its cut", () => {
    const cut = KEYINGS.find((k) => k.cutAt !== undefined);
    expect(cut).toBeDefined();
    if (!cut?.cutAt) return;
    expect(spokenSeconds(cut, 20)).toBeCloseTo(cut.cutAt - cut.startAt);
    expect(linkUp(cut.cutAt + 0.01)).toBe(false);
  });

  it("keeps every keying inside the playback and on a live link", () => {
    for (const k of KEYINGS) {
      expect(k.startAt + k.seconds).toBeLessThanOrEqual(PLAYBACK_SECONDS);
      expect(linkUp(k.startAt)).toBe(true);
    }
  });
});

describe("speechChunks", () => {
  it("is the same every time and as long as asked", () => {
    expect(speechChunks(1, 180)).toEqual(speechChunks(1, 180));
    expect(speechChunks(1, 180)).toHaveLength(50);
  });

  it("has silences between words and sound in between", () => {
    const bytes = speechChunks(2, 180).map((c) => c.amplitudeByte);
    expect(bytes.some((b) => b === 0)).toBe(true);
    expect(Math.max(...bytes)).toBeGreaterThan(150);
  });
});
