import { OWNERSHIP_ACK_WINDOW_MS } from "@ksp-gonogo/sitrep-sdk/spine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client";
import { makeMeta, StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * The whole chain, end to end: a subscribe leaves, the mod answers it or does
 * not, and a widget's `Reading` says which.
 *
 * Nothing here mocks the client, the store or the reading builder. The only
 * fake is the transport, which stands in for the socket, and the thing being
 * proven is exactly what a real one would carry: an `event` frame, or silence.
 */
function harness(options: { decidesTopicOwnership?: boolean } = {}) {
  const transport = new StubTransport({
    decidesTopicOwnership: options.decidesTopicOwnership ?? true,
  });
  const client = new TelemetryClient(transport);
  const store = new TimelineStore(
    new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
  );
  const detach = client.attachStore(store);
  store.beginFrame();
  return { transport, client, store, detach };
}

describe("a topic nothing will ever publish", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads pending while the mod has simply not answered yet", () => {
    const { client, store } = harness();
    client.subscribe("nobody.publishes.this", () => {});
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS - 1);
    store.beginFrame();
    expect(store.sampleReading("nobody.publishes.this")).toEqual({
      state: "pending",
    });
  });

  it("reads unowned once the mod's silence has gone on long enough", () => {
    const { client, store } = harness();
    client.subscribe("nobody.publishes.this", () => {});
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS);
    expect(store.sampleReading("nobody.publishes.this")).toEqual({
      state: "unowned",
    });
  });

  it("stays pending forever once the mod acks and just has nothing yet", () => {
    const { transport, client, store } = harness();
    client.subscribe("vessel.orbit", () => {});
    transport.ackSubscribe("vessel.orbit");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS * 10);
    store.beginFrame();
    expect(store.sampleReading("vessel.orbit")).toEqual({ state: "pending" });
  });

  /**
   * The false-unowned guard, and the reason `decidesTopicOwnership` defaults
   * off. A station, a replay and a stub all deliver frames without ever acking,
   * and none of them may conclude anything from that.
   */
  it("never decides on a transport that does not relay acks", () => {
    const { client, store } = harness({ decidesTopicOwnership: false });
    client.subscribe("nobody.publishes.this", () => {});
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS * 10);
    store.beginFrame();
    expect(store.sampleReading("nobody.publishes.this")).toEqual({
      state: "pending",
    });
    expect(client.topicOwnership("nobody.publishes.this")).toBe("undecided");
  });

  it("notifies frame listeners the moment the verdict lands", () => {
    const { client, store } = harness();
    client.subscribe("nobody.publishes.this", () => {});
    // Subscribed AFTER the read starts, exactly as `useTelemetry` does, and no
    // frame is minted in between: a dashboard with no live data mints none, so
    // a verdict that only surfaced on the next frame would never surface.
    const notified = vi.fn();
    store.subscribeFrame(notified);
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS);
    expect(notified).toHaveBeenCalled();
  });

  it("tells a listener which topic, once", () => {
    const { client } = harness();
    const seen: string[] = [];
    client.onTopicUnowned((topic) => seen.push(topic));
    client.subscribe("nobody.publishes.this", () => {});
    client.subscribe("vessel.orbit", () => {});
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS * 3);
    expect(seen).toEqual(["nobody.publishes.this", "vessel.orbit"]);
  });

  /**
   * An observation outranks the verdict outright. A topic that has published
   * is owned by the fact of having done so, whatever a stale judgement says.
   */
  it("shows the value when one arrives after a verdict was reached", () => {
    const { transport, client, store } = harness();
    client.subscribe("vessel.altitude", () => {});
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS);
    expect(store.sampleReading("vessel.altitude")).toEqual({
      state: "unowned",
    });

    transport.emitRaw({
      type: "stream-data",
      topic: "vessel.altitude",
      payload: 1234,
      meta: makeMeta({ validAt: 0, deliveredAt: 0 }),
    });
    store.beginFrame();
    expect(store.sampleReading("vessel.altitude")).toMatchObject({
      state: "observed",
    });
  });

  it("backfills a verdict onto a store attached after it was reached", () => {
    const { client } = harness();
    client.subscribe("nobody.publishes.this", () => {});
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS);

    const late = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    client.attachStore(late);
    late.beginFrame();
    expect(late.sampleReading("nobody.publishes.this")).toEqual({
      state: "unowned",
    });
  });

  it("keeps a reading's identity stable across reads once the verdict lands", () => {
    // `useSyncExternalStore` compares by reference, so an `unowned` arm rebuilt
    // per getSnapshot is an infinite render loop rather than a wasted object.
    const { client, store } = harness();
    client.subscribe("nobody.publishes.this", () => {});
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS);
    store.beginFrame();
    const first = store.sampleReading("nobody.publishes.this");
    const second = store.sampleReading("nobody.publishes.this");
    // Asserted before the identity check so this cannot pass by both reads
    // agreeing on the WRONG arm, which is how it first passed.
    expect(first).toEqual({ state: "unowned" });
    expect(second).toBe(first);
  });
});
