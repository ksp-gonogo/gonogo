import { describe, expect, it } from "vitest";
import type { Transport, TransportStatus } from "../api/transport";
import type { ServerMessage } from "../envelope";
import { makeMeta } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import type { Clock } from "./clock";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

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

describe("a load that does not rewind the game, as a switch of craft is", () => {
  it("keeps the epoch when a craft's own reading trails the frames the load sent before it", () => {
    const wire = new Wire();
    const client = new TelemetryClient(wire, CLOCK, { idPrefix: "p" });
    client.subscribe("life-support.profile", () => {});
    const viewClock = new ViewClock();
    client.attachStore(new TimelineStore(viewClock));
    wire.deliver({
      type: "hello",
      bootId: "b",
      timelineEpoch: 1,
      contractMajor: 1,
      contractMinor: 0,
    });
    // Recorded on the Deck at a switch: an Uplink's reading of the old craft taken a tick before the load, delivered on its own clock after the load's first frames.
    wire.deliver(frame("vessel.flight", 1, 115.6));
    wire.deliver({
      type: "game-state",
      state: "loading",
      scene: "FLIGHT",
      bootId: "b",
      timelineEpoch: 1,
    });
    wire.deliver(frame("ksp.activeVessel", 1, 116.6));
    wire.deliver({
      type: "stream-data",
      topic: "life-support.transmission",
      payload: {},
      meta: makeMeta({
        timelineEpoch: 1,
        deliveredAt: 116.0047,
        source: "fleet.fe9bd1e1",
      }),
    });
    expect(viewClock.getEpoch()).toBe(1);
  });

  it("keeps the epoch when the game sat in the switch dialog while the clock's estimate ran on", () => {
    let now = 100;
    const wire = new Wire();
    const client = new TelemetryClient(
      wire,
      { now: () => now, schedule: () => () => {} },
      { idPrefix: "p" },
    );
    client.subscribe("spaceCenter.scene", () => {});
    const viewClock = new ViewClock();
    client.attachStore(new TimelineStore(viewClock));
    wire.deliver({
      type: "hello",
      bootId: "b",
      timelineEpoch: 1,
      contractMajor: 1,
      contractMinor: 0,
    });
    // Recorded from a switch on the Deck: the last frame before the dialog, then wall seconds with the game held.
    wire.deliver(frame("spaceCenter.scene", 1, 379.08));
    now = 104;
    wire.deliver({
      type: "game-state",
      state: "loading",
      scene: "FLIGHT",
      bootId: "b",
      timelineEpoch: 1,
    });
    now = 108;
    wire.deliver(frame("vessel.flight", 1, 379.92));
    expect(viewClock.getEpoch()).toBe(1);
  });

  it("keeps the epoch when a frame is stamped a float step behind another of the same instant", () => {
    const wire = new Wire();
    const client = new TelemetryClient(wire, CLOCK, { idPrefix: "p" });
    for (const topic of [
      "spaceCenter.scene",
      "comms.nextLoss",
      "vessel.target",
    ]) {
      client.subscribe(topic, () => {});
    }
    const viewClock = new ViewClock();
    client.attachStore(new TimelineStore(viewClock));
    wire.deliver({
      type: "hello",
      bootId: "b",
      timelineEpoch: 1,
      contractMajor: 1,
      contractMinor: 0,
    });
    wire.deliver(frame("spaceCenter.scene", 1, 7121.640000000472));
    wire.deliver({
      type: "game-state",
      state: "loading",
      scene: "FLIGHT",
      bootId: "b",
      timelineEpoch: 1,
    });
    wire.deliver(frame("comms.nextLoss", 1, 7135.100000000766));
    wire.deliver(frame("vessel.target", 1, 7135.100000000765));
    expect(viewClock.getEpoch()).toBe(1);
  });

  it("still reads a load that goes back by a second as a rewind", () => {
    const wire = new Wire();
    const client = new TelemetryClient(wire, CLOCK, { idPrefix: "p" });
    for (const topic of [
      "spaceCenter.scene",
      "comms.nextLoss",
      "vessel.target",
    ]) {
      client.subscribe(topic, () => {});
    }
    const viewClock = new ViewClock();
    client.attachStore(new TimelineStore(viewClock));
    wire.deliver({
      type: "hello",
      bootId: "b",
      timelineEpoch: 1,
      contractMajor: 1,
      contractMinor: 0,
    });
    wire.deliver(frame("spaceCenter.scene", 1, 7135));
    wire.deliver({
      type: "game-state",
      state: "loading",
      scene: "FLIGHT",
      bootId: "b",
      timelineEpoch: 1,
    });
    wire.deliver(frame("vessel.target", 1, 7134));
    expect(viewClock.getEpoch()).toBe(2);
  });
});
