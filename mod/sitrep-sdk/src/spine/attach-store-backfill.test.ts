import { describe, expect, it } from "vitest";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function newStore(): TimelineStore {
  return new TimelineStore(
    new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    }),
  );
}

describe("a store attached after a topic has arrived", () => {
  it("reads the topic's newest sample without the wire sending it again", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const first = newStore();
    client.attachStore(first);
    client.subscribe("v.alt", () => {});
    transport.emit("v.alt", 12345);

    const late = newStore();
    client.attachStore(late);
    client.subscribe("v.alt", () => {});
    late.beginFrame();

    const reading = late.sampleReading<number>("v.alt", late.currentFrame());
    expect(reading.state).not.toBe("pending");
    client.dispose();
  });

  it("starts from nothing once the last subscriber has released the topic", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    client.attachStore(newStore());
    const release = client.subscribe("v.alt", () => {});
    transport.emit("v.alt", 12345);
    release();

    const late = newStore();
    client.attachStore(late);
    late.beginFrame();

    expect(late.sampleReading("v.alt", late.currentFrame()).state).toBe(
      "pending",
    );
    client.dispose();
  });
});
