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
const HOME = "ground:KSC";
const OTHER = "ground:Island";
const START_UT = 1000;
const DELAY = 27.4;
/** The light-time of the route through another relay the contact plan still holds open while the game has cut the craft. */
const PLAN_ROUTE = 10.9;

/**
 * A main screen at the home centre, fed what the mod sends through a loss by
 * occultation: the link report going down, comms.delay reporting no path, and
 * the plan's shorter route still offered as a prediction on comms.route and on
 * another centre's row.
 */
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
  client.setVantage(HOME);
  for (const topic of [
    "comms.delay",
    "comms.link",
    "comms.route",
    "commandCentre.roster",
    "commandCentre.activeVesselDelay",
  ]) {
    client.subscribe(topic, () => {});
  }
  let seq = 0;
  const gameUt = () => START_UT + wall;
  const send = (topic: string, payload: unknown, validAt: number) => {
    transport.deliver({
      type: "stream-data",
      topic,
      payload,
      meta: makeMeta({
        validAt,
        deliveredAt: gameUt(),
        seq: seq++,
        vantage: HOME,
      }),
    } as ServerMessage);
  };
  send(
    "commandCentre.roster",
    [
      { id: HOME, isHome: true },
      { id: OTHER, isHome: false },
    ],
    gameUt(),
  );
  const planRoute = () =>
    send(
      "comms.route",
      {
        routes: [
          {
            from: CRAFT,
            to: HOME,
            sentUt: gameUt(),
            arrivalUt: gameUt() + PLAN_ROUTE,
            seconds: PLAN_ROUTE,
            live: true,
          },
        ],
      },
      gameUt(),
    );
  return {
    authority,
    clock,
    inContact: () => {
      send(
        "comms.delay",
        { oneWaySeconds: DELAY, source: 1, meta: { source: CRAFT } },
        gameUt() - DELAY,
      );
      send("comms.link", { connected: true }, gameUt() - DELAY);
    },
    inTheLoss: () => {
      send("comms.link", { connected: false }, gameUt() - DELAY);
      send(
        "comms.delay",
        { oneWaySeconds: null, source: 0, meta: { source: CRAFT } },
        gameUt() - DELAY,
      );
      planRoute();
      send(
        "commandCentre.activeVesselDelay",
        { centres: [{ id: OTHER, oneWaySeconds: PLAN_ROUTE }] },
        gameUt(),
      );
    },
    tick: () => {
      wall += 1;
    },
  };
}

describe("the delay at the home centre through a loss", () => {
  it("holds the in-contact figure from the first connected=false until the first connected=true", () => {
    const r = rig();
    for (let i = 0; i < 60; i++) {
      r.inContact();
      r.tick();
    }
    expect(r.clock.delaySeconds()).toBe(DELAY);

    const held: number[] = [];
    for (let i = 0; i < 300; i++) {
      r.inTheLoss();
      held.push(r.clock.delaySeconds());
      r.clock.viewUt();
      r.tick();
    }
    expect(new Set(held)).toEqual(new Set([DELAY]));

    r.inContact();
    expect(r.clock.delaySeconds()).toBe(DELAY);
  });
});
