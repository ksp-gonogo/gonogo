import { describe, expect, it } from "vitest";
import type { ServerMessage } from "./envelope";

function topicOf(m: ServerMessage): string | undefined {
  switch (m.type) {
    case "stream-data":
      return m.topic; // narrowed to StreamData<unknown>
    case "event":
      return m.topic; // narrowed to EventMsg
    case "command-response":
      return m.requestId; // narrowed to CommandResponse<unknown>
    case "error":
      return m.code; // narrowed to ErrorMsg
  }
}

describe("ServerMessage discriminated union", () => {
  it("narrows on the type tag", () => {
    const msg: ServerMessage = {
      type: "stream-data",
      topic: "vessel.altitude",
      payload: 1234,
      meta: {
        source: "test",
        validAt: 0,
        seq: 0,
        deliveredAt: 0,
        vantage: "main",
        quality: 1,
        active: true,
        staleness: 0,
        timelineEpoch: 0,
      },
    };
    expect(topicOf(msg)).toBe("vessel.altitude");
  });
});
