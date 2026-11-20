import { describe, expect, it } from "vitest";
import { replayOutput } from "./replayMode";

const frame = (topic: string, validAt: number, carried?: boolean): string =>
  JSON.stringify({
    type: "stream-data",
    topic,
    ...(carried ? { carried } : {}),
    payload: {},
    meta: { validAt, deliveredAt: validAt },
  });

describe("a recording as what the replay mode shows", () => {
  it("runs its timeline over the flight, not back to the state the recording began from", () => {
    const frames = [
      frame("trackingStation.bodies", 10, true),
      frame("vessel.flight", 500),
      frame("vessel.flight", 560),
    ];
    const output = replayOutput(frames);
    expect([output.startUt, output.endUt]).toEqual([500, 560]);
    // Every frame is still handed on, the carried one included: it is what the first moment shows.
    expect(output.frames).toEqual(frames);
  });

  it("has nothing to show for a recording that holds only the state it began from", () => {
    const output = replayOutput([frame("trackingStation.bodies", 10, true)]);
    expect(output.noTimeline).toBe("Nothing recorded");
  });
});
