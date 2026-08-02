import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  fileURLToPath(
    new URL("./__generated__/control-channels.ts", import.meta.url),
  ),
  "utf8",
);

describe("generated control-channels.ts", () => {
  it("declares the throttle bidirectional channel with both wire keys", () => {
    expect(src).toMatch(/id:\s*"vessel\.control\.throttle"/);
    expect(src).toMatch(/readTopic:\s*"vessel\.control"/);
    expect(src).toMatch(/readField:\s*"throttle"/);
    expect(src).toMatch(/writeCommand:\s*"vessel\.control\.setThrottle"/);
    expect(src).toMatch(/argsType:\s*"SetThrottleArgs"/);
    expect(src).toMatch(/valueField:\s*"value"/);
  });

  it("exports the const array and the id union", () => {
    expect(src).toMatch(/export const GENERATED_CONTROL_CHANNELS/);
    expect(src).toMatch(/export type GeneratedControlChannelId/);
  });
});
