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
const DELAY = 27.4;
/** The game's pace against the wall clock, as a machine that cannot keep up runs it. */
const PACE = 0.9;
/** Half a wall step of slack: a flip is observed on the step it lands in. */
const STEP = 0.5;

/**
 * A main screen fed by a game running at `PACE` of its warp rate. Each `tick`
 * is half a wall second; `deliver` sends what the mod sends at that instant,
 * stamped with the game's own UT.
 */
function rig(warp: number) {
  let wall = 0;
  const authority = new DelayAuthority();
  const clock = new ViewClock({
    nowWall: () => wall,
    delaySeconds: authority.delaySeconds,
    delayEpoch: authority.delayEpoch,
    warpRate: () => warp,
  });
  const store = new TimelineStore(clock);
  const transport = new WireTransport();
  const client = new TelemetryClient(transport);
  client.attachStore(store);
  authority.attach(client);
  for (const topic of ["comms.delay", "comms.link", "vessel.flight"]) {
    client.subscribe(topic, () => {});
  }
  let seq = 0;
  const gameUt = () => START_UT + wall * warp * PACE;
  const send = (topic: string, payload: unknown, validAt: number) => {
    transport.deliver({
      type: "stream-data",
      topic,
      payload,
      meta: makeMeta({
        validAt,
        deliveredAt: gameUt(),
        seq: seq++,
        vantage: "ground:KSC",
      }),
    } as ServerMessage);
  };
  return {
    clock,
    gameUt,
    /** What the screen shows as its present: the header's view time and the loss banner's edge. */
    shown: () => [clock.viewUt(), clock.confirmedEdgeUt()],
    inContact: () => {
      send(
        "comms.delay",
        { oneWaySeconds: DELAY, source: 1, meta: { source: CRAFT } },
        gameUt(),
      );
      send("vessel.flight", {}, gameUt() - DELAY);
      send("comms.link", { connected: true }, gameUt() - DELAY);
    },
    linkReport: (connected: boolean, validAt: number) =>
      send("comms.link", { connected }, validAt),
    tick: () => {
      wall += STEP;
    },
  };
}

describe.each([
  1, 4,
])("a game running slower than its warp rate %ix", (warp) => {
  it("keeps the view one delay behind the game through a loss, so the flips land no earlier than light allows", () => {
    const r = rig(warp);
    const latest = () => r.gameUt() - DELAY;
    const expectNotAhead = () => {
      for (const ut of r.shown()) {
        expect(ut).toBeLessThanOrEqual(latest() + 1e-6);
      }
    };

    for (let i = 0; i < 120; i++) {
      r.inContact();
      expectNotAhead();
      r.tick();
    }

    // The link drops at this UT; the mod reports it one delay later and then goes quiet.
    const lostAt = r.gameUt();
    while (r.gameUt() < lostAt + DELAY) {
      expectNotAhead();
      r.tick();
    }
    r.linkReport(false, lostAt);
    const [lossShown] = r.shown();
    expect(lossShown).toBeGreaterThanOrEqual(lostAt - STEP * warp);
    expect(lossShown).toBeLessThanOrEqual(lostAt + STEP * warp);

    // Five minutes of wall time with nothing from the craft.
    const returnAt = r.gameUt() + 300 * PACE * warp;
    while (r.gameUt() < returnAt + DELAY) {
      expectNotAhead();
      r.tick();
    }
    r.linkReport(true, returnAt);
    const [returnShown, returnEdge] = r.shown();
    expect(returnShown).toBeLessThanOrEqual(returnAt + STEP * warp);
    expect(returnEdge).toBeGreaterThanOrEqual(returnAt - STEP * warp);
    expectNotAhead();
  });
});
