import { describe, expect, it } from "vitest";
import type { Transport, TransportStatus } from "../api/transport";
import { parseServerMessage } from "../client";
import type { ClientMessage, ServerMessage } from "../envelope";
import { TelemetryClient } from "./client";
import "./core-reckoners";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

class Wire implements Transport {
  status: TransportStatus = "connected";
  private readonly listeners = new Set<(m: ServerMessage) => void>();
  send(_message: ClientMessage) {}
  onMessage(listener: (m: ServerMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onStatusChange() {
    return () => {};
  }
  deliver(frame: object) {
    for (const l of this.listeners) {
      l(parseServerMessage(JSON.stringify(frame)));
    }
  }
}

const A = "aaaaaaaa-0000-0000-0000-000000000000";
const B = "bbbbbbbb-0000-0000-0000-000000000000";
const DELAY = 1800;
const SWITCH_TO_B = 3600;
const SWITCH_BACK = 3720;

const meta = (validAt: number, deliveredAt: number, seq: number) => ({
  source: "system",
  validAt,
  deliveredAt,
  seq,
  vantage: "ground:KSC",
  quality: 0,
  active: true,
  staleness: 0,
  timelineEpoch: 1,
  sampleId: seq,
});

/** Who the game was flying when a reading was made. */
const flownAt = (ut: number) => (ut >= SWITCH_TO_B && ut < SWITCH_BACK ? B : A);

/**
 * What the command centre's screen reads for the active craft's flight Topic
 * when two craft are 30 light minutes away: an hour on the first, two minutes
 * on the second, then back to the first. The frames are the ones the mod
 * delivers for that scenario (`ActiveVesselSwitchScenarioTests`): the game's
 * own word on who is flown at once, and each reading one delay after it was
 * made, whoever was flown then.
 */
function run() {
  let wall = 0;
  const store = new TimelineStore(
    new ViewClock({
      nowWall: () => wall,
      warpRate: () => 1,
      delaySeconds: () => DELAY,
    }),
  );
  const wire = new Wire();
  const client = new TelemetryClient(wire);
  client.attachStore(store);
  for (const topic of ["vessel.flight", "ksp.activeVessel"]) {
    client.subscribe(topic, () => {});
  }
  let seq = 0;
  const at = new Map<number, string>();
  for (let ut = 0; ut <= SWITCH_BACK + 2100; ut += 30) {
    wall = ut;
    const active = flownAt(ut);
    wire.deliver({
      type: "stream-data",
      topic: "ksp.activeVessel",
      payload: { vesselId: active, name: active === A ? "A" : "B" },
      meta: meta(ut, ut, ++seq),
    });
    const made = ut - DELAY;
    if (made >= 0) {
      const who = flownAt(made);
      wire.deliver({
        type: "stream-data",
        topic: "vessel.flight",
        payload: {
          altitudeAsl: who === A ? made : 1_000_000 + made,
          meta: { source: `vessel:${who}` },
        },
        meta: meta(made, ut, ++seq),
      });
    }
    if (ut === SWITCH_BACK) {
      wire.deliver({
        type: "stream-data",
        topic: "vessel.flight",
        payload: null,
        meta: meta(SWITCH_BACK - 0.001, ut, ++seq),
      });
    }
    store.beginFrame();
    const frame = store.currentFrame();
    const header = store.sampleReading<{ name: string }>(
      "ksp.activeVessel",
      frame,
    );
    const flight = store.sampleReading<{ altitudeAsl: number }>(
      "vessel.flight",
      frame,
    );
    const name =
      header.state === "observed" || header.state === "held"
        ? header.value.name
        : header.state;
    const shown =
      flight.state === "observed" || flight.state === "held"
        ? String(Number(flight.value.altitudeAsl))
        : flight.state;
    at.set(ut, `${name}:${shown}`);
  }
  return (minutesAfterFirstSwitch: number) =>
    at.get(SWITCH_TO_B + minutesAfterFirstSwitch * 60);
}

describe("two craft 30 light minutes away, an hour on A, 2 minutes on B, then back to A", () => {
  const read = run();

  it("names the craft the game flies at once, at both switches", () => {
    expect(read(-0.5)).toMatch(/^A:/);
    expect(read(0)).toMatch(/^B:/);
    expect(read(2)).toMatch(/^A:/);
  });

  it("shows A's last half hour in flight until the first switch, and nothing in its place while B is flown", () => {
    expect(read(-0.5)).toBe("A:1770");
    for (const minutes of [0, 0.5, 1, 1.5]) {
      expect(read(minutes)).toBe("B:pending");
    }
  });

  it("shows A's readings already in flight again as soon as A is flown again, at the age they have", () => {
    expect(read(2)).toBe("A:1920");
    expect(read(10)).toBe("A:2400");
    expect(read(29.5)).toBe("A:3570");
  });

  it("shows nothing of A for the two minutes B was flown, whose readings arrive meanwhile and are not A's", () => {
    for (const minutes of [30, 30.5, 31, 31.5]) {
      expect(read(minutes)).toBe("A:pending");
    }
  });

  it("shows A's new readings from 32 minutes after the first switch", () => {
    expect(read(32)).toBe("A:3720");
    expect(read(35)).toBe("A:3900");
  });
});
