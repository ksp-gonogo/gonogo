/**
 * End-to-end-ish test: a station arms a trigger, the host fires it when
 * telemetry crosses the threshold, and the station receives an updated
 * snapshot reflecting the dispatched burn.
 *
 * Skips PeerJS entirely — the bridge is two callback sets that mimic the
 * peer host/client surfaces consumed by the trigger services. That keeps
 * the test focused on the trigger contracts without dragging the real
 * PeerJS stack along.
 */

import type {
  ArmTriggerInput,
  FrozenPlanInputs,
  TriggerSnapshot,
} from "@gonogo/components";
import { describe, expect, it, vi } from "vitest";
import { ManeuverTriggerClientService } from "../maneuverTriggers/ManeuverTriggerClientService";
import { ManeuverTriggerHostService } from "../maneuverTriggers/ManeuverTriggerHostService";
import type { PeerClientService } from "../peer/PeerClientService";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";

const FROZEN: FrozenPlanInputs = {
  preset: "circularize-apo",
  prograde: 0,
  normal: 0,
  radial: 0,
  burnInSeconds: 60,
  utMode: "relative",
  burnAtUT: 0,
  targetInclination: 0,
  targetAltitudeKm: 100,
  standoffMeters: 500,
};

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    length: 0,
    clear: () => map.clear(),
    key: () => null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  } as Storage;
}

function fakeTelemetry(initial: Record<string, unknown>) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const subs = new Map<string, Set<(v: unknown) => void>>();
  const calls: string[] = [];
  return {
    getLatestValue: (k: string) => store.get(k),
    execute: vi.fn(async (a: string) => {
      calls.push(a);
    }),
    subscribe: (k: string, cb: (v: unknown) => void) => {
      let bucket = subs.get(k);
      if (!bucket) {
        bucket = new Set();
        subs.set(k, bucket);
      }
      bucket.add(cb);
      return () => bucket?.delete(cb);
    },
    set(k: string, v: unknown) {
      store.set(k, v);
      const bucket = subs.get(k);
      if (bucket) for (const cb of bucket) cb(v);
    },
    calls,
  };
}

/** Minimal PeerHostService stub — only the surface the host service uses. */
function fakePeerHost() {
  let armCb:
    | ((
        peerId: string,
        msg: Extract<PeerMessage, { type: "trigger-arm" }>,
      ) => void)
    | null = null;
  let cancelCb: ((peerId: string, id: string) => void) | null = null;
  let onBroadcast: ((msg: PeerMessage) => void) | null = null;
  return {
    broadcast(msg: PeerMessage) {
      onBroadcast?.(msg);
    },
    onTriggerArm(cb: typeof armCb) {
      armCb = cb;
      return () => {
        armCb = null;
      };
    },
    onTriggerCancel(cb: typeof cancelCb) {
      cancelCb = cb;
      return () => {
        cancelCb = null;
      };
    },
    /** Test wiring — feed a station-originated arm into the host. */
    feedArm(
      peerId: string,
      msg: Extract<PeerMessage, { type: "trigger-arm" }>,
    ) {
      armCb?.(peerId, msg);
    },
    feedCancel(peerId: string, id: string) {
      cancelCb?.(peerId, id);
    },
    setOnBroadcast(cb: (msg: PeerMessage) => void) {
      onBroadcast = cb;
    },
  };
}

/** Minimal PeerClientService stub — only the surface used by the client. */
function fakePeerClient() {
  let snapCb: ((snap: TriggerSnapshot) => void) | null = null;
  let outgoing: PeerMessage[] = [];
  return {
    onTriggerSnapshot(cb: (snap: TriggerSnapshot) => void) {
      snapCb = cb;
      return () => {
        snapCb = null;
      };
    },
    sendTriggerArm(input: ArmTriggerInput) {
      outgoing.push({ type: "trigger-arm", ...input });
    },
    sendTriggerCancel(id: string) {
      outgoing.push({ type: "trigger-cancel", id });
    },
    /** Test wiring — feed a host-originated snapshot down to the client. */
    deliver(msg: PeerMessage) {
      if (msg.type === "trigger-snapshot") snapCb?.(msg.snapshot);
    },
    drainOutgoing(): PeerMessage[] {
      const out = outgoing;
      outgoing = [];
      return out;
    },
  };
}

describe("Maneuver trigger peer roundtrip", () => {
  it("station arms → host fires → client snapshot reflects removal", () => {
    const t = fakeTelemetry({
      "v.name": "Test Vessel",
      "v.body": "Kerbin",
      "o.referenceBody": "Kerbin",
      "o.sma": 700_000,
      "o.eccentricity": 0.01,
      "o.ApR": 707_000,
      "o.PeR": 693_000,
      "o.timeToAp": 900,
      "o.timeToPe": 1800,
      "o.argumentOfPeriapsis": 0,
      "o.trueAnomaly": 0,
      "o.inclination": 0,
      "o.lan": 0,
      "o.period": 3600,
      "o.orbitalSpeed": 2300,
      "o.radius": 700_000,
      "t.universalTime": 1_000_000,
      "o.ApA": 50_000,
    });
    const host = fakePeerHost();
    const client = fakePeerClient();
    // Wire host broadcasts straight into the client.
    host.setOnBroadcast((msg) => client.deliver(msg));

    const hostSvc = new ManeuverTriggerHostService(
      host as unknown as PeerHostService,
      t,
      { storage: memoryStorage() },
    );
    const clientSvc = new ManeuverTriggerClientService(
      client as unknown as PeerClientService,
    );

    // Station arms via its peer-client surface.
    clientSvc.arm({
      dataKey: "o.ApA",
      op: ">=",
      value: 80_000,
      inputs: FROZEN,
    });
    // Replay the outgoing arm into the host.
    for (const msg of client.drainOutgoing()) {
      if (msg.type === "trigger-arm") host.feedArm("station-1", msg);
    }

    // Host has the trigger; client snapshot mirrors it after broadcast.
    expect(hostSvc.snapshot().triggers).toHaveLength(1);
    expect(clientSvc.snapshot().triggers).toHaveLength(1);
    expect(clientSvc.snapshot().triggers[0].createdBy).toBe("station-1");
    expect(t.calls).toEqual([]);

    // Telemetry crosses the threshold — host fires + dispatches burn.
    t.set("o.ApA", 100_000);
    expect(t.calls.length).toBe(1);
    expect(t.calls[0]).toMatch(/^o\.addManeuverNode\[/);

    // Client snapshot reflects the removal.
    expect(hostSvc.snapshot().triggers).toHaveLength(0);
    expect(clientSvc.snapshot().triggers).toHaveLength(0);

    hostSvc.dispose();
  });

  it("station cancel reaches the host and clears the trigger", () => {
    const t = fakeTelemetry({
      "v.name": "Test Vessel",
      "o.ApA": 50_000,
    });
    const host = fakePeerHost();
    const client = fakePeerClient();
    host.setOnBroadcast((msg) => client.deliver(msg));
    const hostSvc = new ManeuverTriggerHostService(
      host as unknown as PeerHostService,
      t,
      { storage: memoryStorage() },
    );
    const clientSvc = new ManeuverTriggerClientService(
      client as unknown as PeerClientService,
    );

    clientSvc.arm({
      dataKey: "o.ApA",
      op: ">=",
      value: 999_999,
      inputs: FROZEN,
    });
    for (const msg of client.drainOutgoing()) {
      if (msg.type === "trigger-arm") host.feedArm("station-1", msg);
    }
    expect(clientSvc.snapshot().triggers).toHaveLength(1);
    const id = clientSvc.snapshot().triggers[0].id;

    clientSvc.cancel(id);
    for (const msg of client.drainOutgoing()) {
      if (msg.type === "trigger-cancel") host.feedCancel("station-1", msg.id);
    }
    expect(hostSvc.snapshot().triggers).toHaveLength(0);
    expect(clientSvc.snapshot().triggers).toHaveLength(0);

    hostSvc.dispose();
  });
});
