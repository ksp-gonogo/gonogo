import type { DataKey, DataSource, DataSourceStatus } from "@gonogo/core";
import { PerfBudget } from "@gonogo/core";
import { describe, expect, it, vi } from "vitest";

// `vi.mock("peerjs", ...)` is hoisted, so the factory can't reference
// classes declared later in this file. Use dynamic imports inside `it()`
// to delay loading PeerHostService until the FakePeer class is in scope.

// Reuse the FakePeer/FakeDataConnection pattern that the existing
// peer-host-service.test.ts uses so the test harness behaves identically
// to other peer tests under StrictMode + jsdom.

type Listener = (...args: unknown[]) => void;

class FakePeer {
  private listeners = new Map<string, Listener[]>();
  static last: FakePeer | null = null;
  constructor(_id?: string) {
    FakePeer.last = this;
    queueMicrotask(() => this.emit("open", "FAKE-PEER-ID"));
  }
  on(event: string, cb: Listener) {
    const bucket = this.listeners.get(event) ?? [];
    bucket.push(cb);
    this.listeners.set(event, bucket);
  }
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((cb) => {
      cb(...args);
    });
  }
  destroy() {}
}

class FakeDataConnection {
  private listeners = new Map<string, Listener[]>();
  peer: string;
  sent: unknown[] = [];
  constructor(peerId: string) {
    this.peer = peerId;
  }
  on(event: string, cb: Listener) {
    const bucket = this.listeners.get(event) ?? [];
    bucket.push(cb);
    this.listeners.set(event, bucket);
  }
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((cb) => {
      cb(...args);
    });
  }
  send(msg: unknown) {
    this.sent.push(msg);
  }
}

vi.mock("peerjs", () => ({ default: FakePeer }));

/**
 * Synthetic Telemachus-like source. ~150 numeric keys; a single
 * `tick()` fans a sample out to every key's subscribers, mimicking what
 * BufferedDataSource does on each WebSocket frame.
 */
function makeSyntheticSource(keyCount: number): DataSource & {
  subscribeSamples: (
    key: string,
    cb: (s: { t: number; v: unknown }) => void,
  ) => () => void;
  tick: (now: number) => void;
} {
  const keys: DataKey[] = Array.from({ length: keyCount }, (_, i) => ({
    key: `synth.${i}`,
  }));
  const sampleSubs = new Map<
    string,
    Set<(s: { t: number; v: unknown }) => void>
  >();
  const valueSubs = new Map<string, Set<(v: unknown) => void>>();
  const statusListeners = new Set<(status: DataSourceStatus) => void>();
  let counter = 0;

  return {
    id: "synth",
    name: "Synth",
    status: "connected",
    connect: async () => {},
    disconnect: () => {},
    schema: () => keys,
    subscribe: (key, cb) => {
      let bucket = valueSubs.get(key);
      if (!bucket) {
        bucket = new Set();
        valueSubs.set(key, bucket);
      }
      bucket.add(cb);
      return () => valueSubs.get(key)?.delete(cb);
    },
    onStatusChange: (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    subscribeSamples: (key, cb) => {
      let bucket = sampleSubs.get(key);
      if (!bucket) {
        bucket = new Set();
        sampleSubs.set(key, bucket);
      }
      bucket.add(cb);
      return () => sampleSubs.get(key)?.delete(cb);
    },
    tick(now: number) {
      counter += 1;
      // 4 Hz worth of samples — fan out to every subscribed key.
      for (const key of keys) {
        const sample = { t: now, v: counter };
        sampleSubs.get(key.key)?.forEach((cb) => {
          cb(sample);
        });
        valueSubs.get(key.key)?.forEach((cb) => {
          cb(counter);
        });
      }
    },
  };
}

describe("peer broadcast benchmark", () => {
  it("baseline — broadcast-all: bytes/sec and count/sec on a 150-key 4Hz feed with 2 peers", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const { PeerBroadcastingDataSource } = await import(
      "../peer/PeerBroadcastingDataSource"
    );

    // Reset the budget rates without clearing the registry — the budget
    // instances are module-level singletons; only their internal counters
    // need to start at zero for this test.
    for (const b of PerfBudget.getAll()) b.reset();

    const host = new PeerHostService();
    // Wait for fake peer "open" → host is ready.
    await new Promise((r) => queueMicrotask(r as () => void));

    // Inject two fake station connections directly. The connection
    // open-handlers fire after `open`, so just push them onto the
    // private set the same way `peer.on('connection', ...)` would.
    const connA = new FakeDataConnection("station-a");
    const connB = new FakeDataConnection("station-b");
    // biome-ignore lint/suspicious/noExplicitAny: reach into private
    (host as any).connections.add(connA);
    // biome-ignore lint/suspicious/noExplicitAny: reach into private
    (host as any).connections.add(connB);

    const source = makeSyntheticSource(150);
    const wrapper = new PeerBroadcastingDataSource(source, host);
    expect(wrapper.id).toBe("synth");

    // Find the budgets registered when PeerHostService was imported.
    const all = PerfBudget.getAll();
    const bytesBudget = all.find((b) => b.name.includes("broadcast bytes"));
    const countBudget = all.find((b) => b.name.includes("broadcast count"));
    expect(bytesBudget).toBeDefined();
    expect(countBudget).toBeDefined();
    if (!bytesBudget || !countBudget) return;

    // Pump 1 second of 4 Hz ticks.
    const tStart = 1_000_000;
    for (let i = 0; i < 4; i++) {
      source.tick(tStart + i * 250);
    }

    const bytesIn1Sec = bytesBudget.rate(tStart + 999);
    const countIn1Sec = countBudget.rate(tStart + 999);

    // Log so the test output shows the absolute numbers — useful when
    // comparing the same test across branches.
    // eslint-disable-next-line no-console
    console.log(
      `[bench broadcast-all] 150 keys × 4 Hz × 2 peers → bytes/sec=${bytesIn1Sec}, msgs/sec=${countIn1Sec}`,
    );

    // Sanity bounds (broadcast-all baseline):
    //   600 keys broadcast × 2 peers = 1200 messages/sec
    //   ~50 bytes per message × 1200 = ~60 KB/sec
    expect(countIn1Sec).toBeGreaterThan(1000);
    expect(countIn1Sec).toBeLessThan(2000);
    expect(bytesIn1Sec).toBeGreaterThan(40_000);
    expect(bytesIn1Sec).toBeLessThan(200_000);

    // Both connections should have received roughly the same number of
    // messages (broadcast-all means every peer gets every key).
    expect(connA.sent.length).toBeGreaterThan(500);
    expect(connB.sent.length).toBeGreaterThan(500);
    expect(Math.abs(connA.sent.length - connB.sent.length)).toBeLessThanOrEqual(
      5,
    );
  });

  it("selective: peer with 10 subscribed keys gets only those — same scenario", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const { PeerBroadcastingDataSource } = await import(
      "../peer/PeerBroadcastingDataSource"
    );

    for (const b of PerfBudget.getAll()) b.reset();

    const host = new PeerHostService();
    await new Promise((r) => queueMicrotask(r as () => void));

    const connA = new FakeDataConnection("station-a");
    const connB = new FakeDataConnection("station-b");
    // biome-ignore lint/suspicious/noExplicitAny: reach into private
    (host as any).connections.add(connA);
    // biome-ignore lint/suspicious/noExplicitAny: reach into private
    (host as any).connections.add(connB);

    const source = makeSyntheticSource(150);
    const wrapper = new PeerBroadcastingDataSource(source, host);
    expect(wrapper.id).toBe("synth");

    // Simulate stations opting into selective mode and subscribing to a
    // subset of keys, exactly the way PeerClientDataSource does in real
    // use. Each station picks 10 keys; the union is 20 of 150.
    const aKeys = Array.from({ length: 10 }, (_, i) => `synth.${i}`);
    const bKeys = Array.from({ length: 10 }, (_, i) => `synth.${i + 100}`);
    // biome-ignore lint/suspicious/noExplicitAny: reach into private
    const handleA = (msg: any) => (host as any).handleIncoming(msg, connA);
    // biome-ignore lint/suspicious/noExplicitAny: reach into private
    const handleB = (msg: any) => (host as any).handleIncoming(msg, connB);
    handleA({ type: "peer-data-mode", mode: "selective" });
    handleB({ type: "peer-data-mode", mode: "selective" });
    handleA({ type: "peer-data-subscribe", sourceId: "synth", keys: aKeys });
    handleB({ type: "peer-data-subscribe", sourceId: "synth", keys: bKeys });

    const all = PerfBudget.getAll();
    const bytesBudget = all.find((b) => b.name.includes("broadcast bytes"));
    const countBudget = all.find((b) => b.name.includes("broadcast count"));
    if (!bytesBudget || !countBudget) throw new Error("budgets missing");
    bytesBudget.reset();
    countBudget.reset();

    const tStart = 1_000_000;
    for (let i = 0; i < 4; i++) source.tick(tStart + i * 250);

    const bytesIn1Sec = bytesBudget.rate(tStart + 999);
    const countIn1Sec = countBudget.rate(tStart + 999);
    // eslint-disable-next-line no-console
    console.log(
      `[bench selective] 150 keys × 4 Hz, peers want 10 each → bytes/sec=${bytesIn1Sec}, msgs/sec=${countIn1Sec}`,
    );

    // 10 keys × 4 Hz × 2 peers (disjoint sets) = 80 messages/sec.
    expect(countIn1Sec).toBeGreaterThanOrEqual(70);
    expect(countIn1Sec).toBeLessThanOrEqual(90);
    // Bytes scale with msg count — should be roughly 1/15 of broadcast-all.
    expect(bytesIn1Sec).toBeLessThan(10_000);

    // Each peer should only see its own key set (40 messages each
    // across the 1-sec window).
    expect(connA.sent.length).toBeGreaterThanOrEqual(35);
    expect(connA.sent.length).toBeLessThanOrEqual(45);
    expect(connB.sent.length).toBeGreaterThanOrEqual(35);
    expect(connB.sent.length).toBeLessThanOrEqual(45);

    // Sanity: connA shouldn't have received connB's keys (synth.100+).
    const aReceivedKeys = new Set(
      // biome-ignore lint/suspicious/noExplicitAny: test-side message decode
      connA.sent.map((m: any) => m.key),
    );
    expect(aReceivedKeys.has("synth.100")).toBe(false);
    expect(aReceivedKeys.has("synth.0")).toBe(true);
  });
});
