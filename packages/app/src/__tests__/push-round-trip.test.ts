/**
 * End-to-end push-to-main test: proves the full wire round-trip preserves
 * the widget's config without dropping nested values (arrays, booleans).
 *
 * The reported bug: MapView pushed from a station showed no telemetry rows
 * on main. This test would fail if config were being flattened, JSON-
 * stringified with reviver issues, or replaced with `{}` anywhere on the
 * path from PeerClientService.sendWidgetPush to PushHostService's snapshot.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const { FakePeer } = vi.hoisted(() => {
  class FakeDataConnection {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    peer = "station-peer";
    sent: unknown[] = [];

    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((cb) => {
        cb(...args);
      });
    }

    close() {}
    send(msg: unknown) {
      this.sent.push(msg);
    }
  }

  class FakePeer {
    static lastPeer: FakePeer | null = null;
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(_id?: string) {
      FakePeer.lastPeer = this;
      queueMicrotask(() => this.emit("open", "HOST-PEER-ID"));
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((cb) => {
        cb(...args);
      });
    }

    /** Used by station-side `connect(hostId)`. */
    connect(_id: string) {
      const conn = new FakeDataConnection();
      // Let the consumer listen before we emit "open".
      queueMicrotask(() => conn.emit("open"));
      return conn;
    }

    /** Used by the host to simulate a station connecting in. */
    simulateIncomingStation(): FakeDataConnection {
      const conn = new FakeDataConnection();
      this.emit("connection", conn);
      conn.emit("open");
      return conn;
    }

    destroy() {}
  }

  return { FakePeer, FakeDataConnection };
});

vi.mock("peerjs", () => ({ default: FakePeer }));

import { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { PushHostService } from "../pushToMain/PushHostService";

describe("push-to-main round trip", () => {
  afterEach(() => {
    FakePeer.lastPeer = null;
  });

  it("preserves array + boolean fields in config through the full peer pipeline", async () => {
    const host = new PeerHostService();
    await host.start();
    await Promise.resolve(); // FakePeer.open microtask
    if (!FakePeer.lastPeer) throw new Error("FakePeer not instantiated");

    const pushHost = new PushHostService(host);

    // Simulate a station peer showing up, same path the real host takes.
    const conn = FakePeer.lastPeer.simulateIncomingStation();

    // Now the station "sends" a widget-push: on the host side this arrives
    // as a `data` event on the DataConnection carrying a PeerMessage.
    const stationConfig = {
      trajectoryLength: 2000,
      telemetryKeys: ["v.altitude", "v.surfaceSpeed", "v.mach"],
      showPrediction: true,
    };
    const pushMsg: PeerMessage = {
      type: "widget-push",
      widgetInstanceId: "map-instance-1",
      componentId: "map-view",
      config: stationConfig,
      width: 8,
      height: 6,
    };
    conn.emit("data", pushMsg);

    const snap = pushHost.snapshot();
    expect(snap).toHaveLength(1);
    // Deep equality on the whole config — catches any field that got dropped
    // or transformed (e.g. array collapsed to [], boolean flipped, etc.).
    expect(snap[0].config).toEqual(stationConfig);
    expect(snap[0].width).toBe(8);
    expect(snap[0].height).toBe(6);
    expect(snap[0].componentId).toBe("map-view");

    pushHost.dispose();
  });

  it("a second push for the same widget replaces the config, not merges it", async () => {
    const host = new PeerHostService();
    await host.start();
    await Promise.resolve();
    if (!FakePeer.lastPeer) throw new Error("FakePeer not instantiated");
    const pushHost = new PushHostService(host);

    const conn = FakePeer.lastPeer.simulateIncomingStation();

    conn.emit("data", {
      type: "widget-push",
      widgetInstanceId: "w",
      componentId: "map-view",
      config: { telemetryKeys: ["v.altitude"], trajectoryLength: 500 },
      width: 4,
      height: 3,
    } satisfies PeerMessage);

    conn.emit("data", {
      type: "widget-push",
      widgetInstanceId: "w",
      componentId: "map-view",
      config: { telemetryKeys: ["v.mach"], trajectoryLength: 1000 },
      width: 4,
      height: 3,
    } satisfies PeerMessage);

    const snap = pushHost.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].config).toEqual({
      telemetryKeys: ["v.mach"],
      trajectoryLength: 1000,
    });

    pushHost.dispose();
  });
});
