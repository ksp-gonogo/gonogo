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
} from "@ksp-gonogo/components";
import {
  StubTransport,
  setActiveCarriedChannelsForTests,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
  vesselStateChannel,
} from "@ksp-gonogo/sitrep-client";
import { afterEach, describe, expect, it } from "vitest";
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

/**
 * `readLiveOrbit()`/`readVesselName()`'s stream leg — see
 * `ManeuverTriggerHostService.test.ts`'s identical fixture for the full
 * reasoning (real `TimelineStore` + `vesselStateChannel`, fed directly via
 * `StubTransport.emit`, no React/`TelemetryProvider` needed). Also the
 * trigger `dataKey` read (`getValue`) and maneuver-node fire's
 * command-dispatch (`dispatchActiveCommand`) leg —
 * `setActiveTelemetryClientForTests`/`setActiveCarriedChannelsForTests`
 * register the client/carried-channels a mounted `TelemetryProvider` would;
 * `calls` records every dispatched `{command, args}` pair via
 * `transport.setCommandHandler`.
 */
function buildOrbitStoreFixture(pinnedUt: number) {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: () => 0,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  clock.scrubTo(pinnedUt);
  const store = new TimelineStore(clock);
  store.registerDerivedChannel(vesselStateChannel);
  client.attachStore(store);
  client.subscribe("vessel.orbit", () => {});
  client.subscribe("vessel.identity", () => {});

  const calls: Array<{ command: string; args: unknown }> = [];
  transport.setCommandHandler((command, args) => {
    calls.push({ command, args });
    return null;
  });

  setActiveTelemetryClientForTests(client);
  setActiveCarriedChannelsForTests(new Set(["vessel.maneuver.add"]));

  return {
    store,
    calls,
    emitOrbit(payload: unknown): void {
      transport.emit("vessel.orbit", payload);
      store.beginFrame();
    },
    emitIdentity(payload: unknown): void {
      transport.emit("vessel.identity", payload);
      store.beginFrame();
    },
  };
}

/**
 * `sma`/`ecc` drive `vessel.state.apoapsisRadius` (`sma·(1+ecc)`,
 * body-radius-independent — see `vessel-state.ts`), which is what this
 * file's `dataKey: "o.ApR"` triggers threshold against: 700_000 · 1.01 =
 * 707_000 at the defaults below.
 */
function kerbinOrbitPayload(pinnedUt: number, sma = 700_000) {
  return {
    referenceBodyIndex: 1,
    sma,
    ecc: 0.01,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: pinnedUt,
    mu: 3.5316e12,
    patches: [],
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
  afterEach(() => {
    setActiveViewClockForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    setActiveTelemetryClientForTests(undefined);
    setActiveCarriedChannelsForTests(undefined);
  });

  it("station arms → host fires → client snapshot reflects removal", async () => {
    // `t.universalTime`'s DROP: the host service reads view-UT via the
    // non-hook `getViewUt()` accessor now — register the fixture's own UT
    // value as the fake view clock so `readLiveOrbit`'s plan computation
    // resolves the same as before.
    setActiveViewClockForTests({ viewUt: () => 1_000_000 });
    // Same DROP, for the vessel/target-orbit + vessel-identity reads AND
    // the trigger dataKey read/maneuver-node fire — register a real store
    // carrying a self-consistent orbit + identity.
    const orbitStore = buildOrbitStoreFixture(1_000_000);
    setActiveTimelineStoreForTests(orbitStore.store);
    orbitStore.emitOrbit(kerbinOrbitPayload(1_000_000));
    orbitStore.emitIdentity({
      vesselId: "test-vessel",
      name: "Test Vessel",
      vesselType: 0,
      situation: 0,
    });
    const host = fakePeerHost();
    const client = fakePeerClient();
    // Wire host broadcasts straight into the client.
    host.setOnBroadcast((msg) => client.deliver(msg));

    const hostSvc = new ManeuverTriggerHostService(
      host as unknown as PeerHostService,
      { storage: memoryStorage() },
    );
    const clientSvc = new ManeuverTriggerClientService(
      client as unknown as PeerClientService,
    );

    // Station arms via its peer-client surface. Baseline apoapsisRadius
    // (707_000) stays below 750_000 — pending until the orbit changes.
    clientSvc.arm({
      dataKey: "o.ApR",
      op: ">=",
      value: 750_000,
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
    expect(orbitStore.calls).toEqual([]);

    // Telemetry crosses the threshold (bump sma so apoapsisRadius clears
    // 750_000) — host fires + dispatches burn.
    orbitStore.emitOrbit(kerbinOrbitPayload(1_000_000, 800_000));
    // The command dispatch settles on a microtask — drain it before
    // asserting (see `ManeuverTriggerHostService.test.ts`'s identical note).
    await Promise.resolve();
    await Promise.resolve();
    expect(orbitStore.calls.length).toBe(1);
    expect(orbitStore.calls[0].command).toBe("vessel.maneuver.add");

    // Client snapshot reflects the removal.
    expect(hostSvc.snapshot().triggers).toHaveLength(0);
    expect(clientSvc.snapshot().triggers).toHaveLength(0);

    hostSvc.dispose();
  });

  it("station cancel reaches the host and clears the trigger", () => {
    const host = fakePeerHost();
    const client = fakePeerClient();
    host.setOnBroadcast((msg) => client.deliver(msg));
    const hostSvc = new ManeuverTriggerHostService(
      host as unknown as PeerHostService,
      { storage: memoryStorage() },
    );
    const clientSvc = new ManeuverTriggerClientService(
      client as unknown as PeerClientService,
    );

    clientSvc.arm({
      dataKey: "o.ApR",
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
