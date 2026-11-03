import { describe, expect, it } from "vitest";
import type { Transport } from "../api/transport";
import type { ServerMessage } from "../envelope";
import { makeMeta } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import { DelayAuthority } from "./delay-authority";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

class WireTransport implements Transport {
  readonly status = "connected" as const;
  private readonly listeners = new Set<(m: ServerMessage) => void>();
  send(): void {}
  onMessage(listener: (m: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onStatusChange(): () => void {
    return () => {};
  }
  deliver(message: ServerMessage): void {
    for (const l of this.listeners) l(message);
  }
}

const CRAFT = "vessel:e1752c17-6977-4412-921e-1fec79f0e09f";
const START_UT = 1000;

function rig() {
  let wall = 0;
  const authority = new DelayAuthority();
  const clock = new ViewClock({
    nowWall: () => wall,
    delaySeconds: authority.delaySeconds,
    delayEpoch: authority.delayEpoch,
  });
  const store = new TimelineStore(clock);
  const transport = new WireTransport();
  const client = new TelemetryClient(transport);
  client.attachStore(store);
  authority.attach(client);
  for (const topic of [
    "comms.delay",
    "comms.route",
    "vessel.flight",
    "commandCentre.roster",
    "commandCentre.activeVesselDelay",
  ]) {
    client.subscribe(topic, () => {});
  }
  let seq = 0;
  const send = (
    topic: string,
    payload: unknown,
    validAt: number,
    deliveredAt: number,
  ) => {
    transport.deliver({
      type: "stream-data",
      topic,
      payload,
      meta: makeMeta({
        validAt,
        deliveredAt,
        seq: seq++,
        vantage: "ground:KSC",
      }),
    } as ServerMessage);
  };
  return {
    client,
    clock,
    send,
    gameUt: () => START_UT + wall,
    tick: () => {
      wall += 1;
    },
  };
}

describe("a page opened inside a blackout", () => {
  it("keeps the view clock running when the first delay figure arrives at the return", () => {
    const { clock, send, gameUt, tick } = rig();
    const DELAY = 27;

    // Opened in the dark: the craft has no path home, so there is no figure.
    for (let i = 0; i < 60; i++) {
      send(
        "comms.delay",
        { oneWaySeconds: null, source: 0, meta: { source: CRAFT } },
        gameUt(),
        gameUt(),
      );
      send("comms.route", { routes: [] }, gameUt(), gameUt());
      clock.viewUt();
      tick();
    }

    // Contact returns: the figure and the delayed readings arrive together.
    const views: number[] = [];
    for (let i = 0; i < 45; i++) {
      send(
        "comms.delay",
        { oneWaySeconds: DELAY, source: 1, meta: { source: CRAFT } },
        gameUt(),
        gameUt(),
      );
      send("vessel.flight", {}, gameUt() - DELAY, gameUt());
      send("comms.route", { routes: [] }, gameUt(), gameUt());
      views.push(clock.viewUt());
      tick();
    }

    for (let i = 1; i < views.length; i++) {
      expect(views[i] - views[i - 1]).toBeGreaterThan(0.5);
    }
    expect(gameUt() - DELAY - views[views.length - 1]).toBeLessThan(2);
  });

  it("keeps the view clock running when a non-home centre's first figure comes from the active-vessel delays", () => {
    const { client, clock, send, gameUt, tick } = rig();
    const OTHER = "ground:Other";
    const OTHER_DELAY = 12;
    client.setVantage(OTHER);

    send("commandCentre.roster", [{ id: "ground:KSC", isHome: true }], 0, 0);
    for (let i = 0; i < 60; i++) {
      send(
        "comms.delay",
        { oneWaySeconds: null, source: 0, meta: { source: CRAFT } },
        gameUt(),
        gameUt(),
      );
      send("comms.route", { routes: [] }, gameUt(), gameUt());
      clock.viewUt();
      tick();
    }

    const views: number[] = [];
    for (let i = 0; i < 30; i++) {
      send(
        "commandCentre.activeVesselDelay",
        { centres: [{ id: OTHER, oneWaySeconds: OTHER_DELAY }] },
        gameUt(),
        gameUt(),
      );
      send("vessel.flight", {}, gameUt() - OTHER_DELAY, gameUt());
      send("comms.route", { routes: [] }, gameUt(), gameUt());
      views.push(clock.viewUt());
      tick();
    }

    expect(clock.delaySeconds()).toBe(OTHER_DELAY);
    for (let i = 1; i < views.length; i++) {
      expect(views[i] - views[i - 1]).toBeGreaterThan(0.5);
    }
  });
});
