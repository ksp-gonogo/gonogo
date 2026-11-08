import { describe, expect, it } from "vitest";
import type { Transport, TransportStatus } from "../api/transport";
import type { ClientMessage, ServerMessage } from "../envelope";
import { makeMeta } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import type { Clock } from "./clock";

const FROZEN_CLOCK: Clock = {
  now: () => 100,
  schedule: () => () => {},
};

class RecordingTransport implements Transport {
  status: TransportStatus = "connected";
  readonly sent: ClientMessage[] = [];
  private readonly messages = new Set<(m: ServerMessage) => void>();

  send(message: ClientMessage) {
    this.sent.push(message);
  }
  onMessage(listener: (m: ServerMessage) => void) {
    this.messages.add(listener);
    return () => this.messages.delete(listener);
  }
  onStatusChange() {
    return () => {};
  }
  deliver(message: ServerMessage, delivery?: { replayed: boolean }) {
    for (const listener of this.messages)
      (listener as (m: ServerMessage, d?: { replayed: boolean }) => void)(
        message,
        delivery,
      );
  }
  get last() {
    return this.sent.at(-1);
  }
}

function setup() {
  const transport = new RecordingTransport();
  return {
    transport,
    client: new TelemetryClient(transport, FROZEN_CLOCK, { idPrefix: "p" }),
  };
}

const hello = (bootId: string, timelineEpoch: number): ServerMessage => ({
  type: "hello",
  bootId,
  timelineEpoch,
  contractMajor: 1,
  contractMinor: 0,
});

const gameState = (
  bootId: string,
  timelineEpoch: number,
  state = "ready",
): ServerMessage => ({
  type: "game-state",
  state,
  scene: "FLIGHT",
  bootId,
  timelineEpoch,
});

describe("commands say which run and timeline they were sent from", () => {
  it("sends the hello's run and epoch", () => {
    const { client, transport } = setup();
    transport.deliver(hello("boot-a", 3));
    client.dispatch("time.setPaused", { paused: true });
    expect(transport.last).toMatchObject({
      seenBootId: "boot-a",
      seenEpoch: 3,
    });
  });

  it("learns a load from the game-state frame on a connection subscribed to nothing", () => {
    const { client, transport } = setup();
    transport.deliver(hello("boot-a", 0));
    transport.deliver(gameState("boot-a", 1));
    client.dispatch("ksp.revertToLaunch");
    expect(transport.last).toMatchObject({ seenEpoch: 1 });
  });

  it("learns a load from a replayed game-state, which is how a late station hears it", () => {
    const { client, transport } = setup();
    transport.deliver(gameState("boot-a", 5), { replayed: true });
    client.dispatch("ksp.revertToLaunch");
    expect(transport.last).toMatchObject({
      seenBootId: "boot-a",
      seenEpoch: 5,
    });
  });

  it("learns a load from a timeline-reset event", () => {
    const { client, transport } = setup();
    transport.deliver(hello("boot-a", 0));
    transport.deliver({
      type: "event",
      topic: "vessel.flight",
      name: "timeline-reset",
      meta: makeMeta({ timelineEpoch: 4 }),
    });
    client.dispatch("ksp.revertToLaunch");
    expect(transport.last).toMatchObject({ seenEpoch: 4 });
  });

  it("sends the raw wire epoch, not the one the client applied after inferring a rewind", () => {
    const { client, transport } = setup();
    transport.deliver(hello("boot-a", 2));
    transport.deliver({
      type: "stream-data",
      topic: "vessel.flight",
      payload: {},
      meta: makeMeta({ timelineEpoch: 2, deliveredAt: 500 }),
    });
    transport.deliver(gameState("boot-a", 2, "loading"));
    transport.deliver({
      type: "stream-data",
      topic: "vessel.flight",
      payload: {},
      meta: makeMeta({ timelineEpoch: 2, deliveredAt: 10 }),
    });
    client.dispatch("ksp.revertToLaunch");
    expect(transport.last).toMatchObject({ seenEpoch: 2 });
  });

  it("counts epochs from zero again when the mod has restarted", () => {
    const { client, transport } = setup();
    transport.deliver(hello("boot-a", 9));
    transport.deliver(hello("boot-b", 0));
    client.dispatch("ksp.revertToLaunch");
    expect(transport.last).toMatchObject({
      seenBootId: "boot-b",
      seenEpoch: 0,
    });
  });

  it("lets a host send a station's own view instead of its own", () => {
    const { client, transport } = setup();
    transport.deliver(hello("boot-now", 8));
    client.dispatch("ksp.revertToLaunch", undefined, "", "", "", "station:c0", {
      seenBootId: "boot-then",
      seenEpoch: 1,
      seenVesselId: "aaaa",
    });
    expect(transport.last).toMatchObject({
      seenBootId: "boot-then",
      seenEpoch: 1,
      seenVesselId: "aaaa",
    });
  });

  it("tells a listener when the epoch moves, and only then", () => {
    const { client, transport } = setup();
    let told = 0;
    client.onTimelineChange(() => told++);
    transport.deliver(hello("boot-a", 1));
    expect(told).toBe(1);
    transport.deliver(hello("boot-a", 1));
    expect(told).toBe(1);
    expect(client.wireEpoch).toBe(1);
  });
});
