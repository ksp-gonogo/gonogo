import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/high-speed-no-solution.json";

const MUN_RADIUS = 200_000;

function figure(channel: string, key: string): number {
  const found = fixture._stream.emits.find((e) => e.channel === channel);
  const entry = Object.entries(found?.value ?? {}).find(([k]) => k === key);
  if (typeof entry?.[1] !== "number") {
    throw new Error(`fixture carries no numeric ${channel}.${key}`);
  }
  return entry[1];
}

describe("high-speed-no-solution fixture", () => {
  it("carries an orbit that puts the craft at the speed and height its flight figures give", () => {
    const radius = MUN_RADIUS + figure("vessel.flight", "altitudeAsl");
    const speedSquared =
      figure("vessel.orbit", "mu") *
      (2 / radius - 1 / figure("vessel.orbit", "sma"));
    expect(Math.sqrt(speedSquared)).toBeCloseTo(
      figure("vessel.flight", "orbitalSpeed"),
      0,
    );
  });
});
