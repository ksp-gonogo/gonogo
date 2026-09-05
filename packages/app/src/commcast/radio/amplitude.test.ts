import { describe, expect, it } from "vitest";
import { chunkAmplitude } from "./amplitude";

function tone(frames: number, peak: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = peak * Math.sin((i / 16) * Math.PI);
  return out;
}

describe("chunkAmplitude", () => {
  it("reads silence as nothing", () => {
    expect(chunkAmplitude(new Float32Array(960))).toBe(0);
  });

  it("reads an empty buffer as nothing rather than NaN", () => {
    expect(chunkAmplitude(new Float32Array(0))).toBe(0);
  });

  it("rises with the signal", () => {
    const quiet = chunkAmplitude(tone(960, 0.02));
    const loud = chunkAmplitude(tone(960, 0.2));
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
  });

  it("stays inside 0..1 for a full-scale chunk", () => {
    const full = chunkAmplitude(tone(960, 1));
    expect(full).toBeLessThanOrEqual(1);
    expect(full).toBeGreaterThan(0.9);
  });

  it("is sign-blind, since a waveform's amplitude is not its polarity", () => {
    const up = new Float32Array(64).fill(0.1);
    const down = new Float32Array(64).fill(-0.1);
    expect(chunkAmplitude(up)).toBe(chunkAmplitude(down));
  });

  it("survives a broken buffer rather than handing on a NaN", () => {
    const broken = new Float32Array(4);
    broken[0] = Number.NaN;
    broken[1] = 0.1;
    expect(Number.isFinite(chunkAmplitude(broken))).toBe(true);
  });
});
