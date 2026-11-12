import { describe, expect, it } from "vitest";
import type { Transport, TransportStatus } from "../api/transport";
import type { ServerMessage } from "../envelope";
import { makeMeta } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import type { Clock } from "./clock";

const CLOCK: Clock = { now: () => 100, schedule: () => () => {} };

class Wire implements Transport {
  status: TransportStatus = "connected";
  private readonly listeners = new Set<(m: ServerMessage) => void>();
  send() {}
  onMessage(listener: (m: ServerMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onStatusChange() {
    return () => {};
  }
  deliver(message: ServerMessage) {
    for (const listener of this.listeners) listener(message);
  }
}

const frame = (
  topic: string,
  timelineEpoch: number,
  deliveredAt: number,
): ServerMessage => ({
  type: "stream-data",
  topic,
  payload: {},
  meta: makeMeta({ timelineEpoch, deliveredAt }),
});

describe("a quickload the mod announces", () => {
  it("keeps the epoch the mod stamped on the frames that follow it", () => {
    const wire = new Wire();
    const client = new TelemetryClient(wire, CLOCK, { idPrefix: "p" });
    const seen: number[] = [];
    client.onRawMessage((m) => {
      if (m.type === "stream-data" && m.topic === "spaceCenter.scene") {
        seen.push(m.meta.timelineEpoch);
      }
    });
    wire.deliver({
      type: "hello",
      bootId: "b",
      timelineEpoch: 9,
      contractMajor: 1,
      contractMinor: 0,
    });
    wire.deliver(frame("vessel.flight", 9, 500));
    wire.deliver({
      type: "game-state",
      state: "loading",
      scene: "FLIGHT",
      bootId: "b",
      timelineEpoch: 9,
    });
    wire.deliver({
      type: "event",
      topic: "vessel.flight",
      name: "timeline-reset",
      meta: makeMeta({ timelineEpoch: 10 }),
    });
    wire.deliver(frame("vessel.flight", 10, 100));
    wire.deliver(frame("spaceCenter.scene", 10, 99));
    expect(seen).toEqual([10]);
  });

  it("reads the scene the mod re-sends right after the reset, whatever UT it carries", () => {
    const wire = new Wire();
    const client = new TelemetryClient(wire, CLOCK, { idPrefix: "p" });
    client.subscribe("spaceCenter.scene", () => {});
    wire.deliver({
      type: "hello",
      bootId: "b",
      timelineEpoch: 9,
      contractMajor: 1,
      contractMinor: 0,
    });
    wire.deliver({
      type: "stream-data",
      topic: "spaceCenter.scene",
      payload: { scene: "Flight" },
      meta: makeMeta({ timelineEpoch: 9, deliveredAt: 500 }),
    });
    wire.deliver(frame("vessel.flight", 9, 500));
    wire.deliver({
      type: "game-state",
      state: "loading",
      scene: "FLIGHT",
      bootId: "b",
      timelineEpoch: 9,
    });
    wire.deliver({
      type: "event",
      topic: "vessel.flight",
      name: "timeline-reset",
      meta: makeMeta({ timelineEpoch: 10 }),
    });
    wire.deliver({
      type: "stream-data",
      topic: "spaceCenter.scene",
      payload: { scene: "Flight" },
      meta: makeMeta({ timelineEpoch: 10, deliveredAt: 100 }),
    });
    expect(client.getValue("spaceCenter.scene")).toEqual({ scene: "Flight" });
  });

  it("reads the scene on a station, which hears the load as a game state and a frame but no reset event", () => {
    const wire = new Wire();
    const client = new TelemetryClient(wire, CLOCK, { idPrefix: "p" });
    client.subscribe("spaceCenter.scene", () => {});
    wire.deliver({
      type: "hello",
      bootId: "b",
      timelineEpoch: 9,
      contractMajor: 1,
      contractMinor: 0,
    });
    wire.deliver({
      type: "stream-data",
      topic: "spaceCenter.scene",
      payload: { scene: "Flight" },
      meta: makeMeta({ timelineEpoch: 9, deliveredAt: 500 }),
    });
    wire.deliver({
      type: "game-state",
      state: "loading",
      scene: "FLIGHT",
      bootId: "b",
      timelineEpoch: 9,
    });
    wire.deliver({
      type: "stream-data",
      topic: "spaceCenter.scene",
      payload: { scene: "Flight" },
      meta: makeMeta({ timelineEpoch: 10, deliveredAt: 100 }),
    });
    expect(client.getValue("spaceCenter.scene")).toEqual({ scene: "Flight" });
  });
});
