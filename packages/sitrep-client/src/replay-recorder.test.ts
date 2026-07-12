import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { TOPIC_IDS } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import type { Clock } from "./clock";
import { StreamRecorder } from "./replay-recorder";
import { ReplayTransport } from "./replay-transport";
import { makeMeta, StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/** Deterministic `Clock` double for driving `ReplayTransport` — mirrors `replay-transport.test.ts`'s own `FakeClock`. */
class FakeClock implements Clock {
  private currentUt: number;
  private pending: { atUt: number; fn: () => void; cancelled: boolean }[] = [];

  constructor(startUt = 0) {
    this.currentUt = startUt;
  }

  now(): number {
    return this.currentUt;
  }

  schedule(atUt: number, fn: () => void): () => void {
    const callback = { atUt, fn, cancelled: false };
    this.pending.push(callback);
    return () => {
      callback.cancelled = true;
    };
  }

  advanceTo(ut: number): void {
    this.currentUt = ut;
    const due = this.pending
      .filter((cb) => !cb.cancelled && cb.atUt <= ut)
      .sort((a, b) => a.atUt - b.atUt);
    this.pending = this.pending.filter((cb) => cb.cancelled || cb.atUt > ut);
    for (const cb of due) cb.fn();
  }
}

describe("StreamRecorder", () => {
  it("default is subscription-scoped: adds no subscriptions beyond whatever's already carried", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    // Simulate a mounted widget already subscribed to one topic.
    client.subscribe("vessel.orbit", () => {});

    const recorder = new StreamRecorder(client);
    recorder.start();

    expect(transport.isSubscribed("vessel.orbit")).toBe(true);
    expect(transport.isSubscribed("vessel.flight")).toBe(false);

    transport.emit("vessel.orbit", { sma: 700_000 }, { validAt: 1 });
    // Unsubscribed topic — StubTransport.emit gates on subscription, so this
    // is a no-op, proving the recorder itself never subscribed vessel.flight.
    transport.emit("vessel.flight", { altitudeAsl: 100 }, { validAt: 1 });

    const fixture = recorder.stop();
    expect(fixture.subscribedTopics).toEqual(["vessel.orbit"]);
    expect(fixture.frames).toHaveLength(1);

    // stop() must not disturb the pre-existing widget subscription.
    expect(transport.isSubscribed("vessel.orbit")).toBe(true);
  });

  it("recordAllTopics subscribes to every TOPIC_IDS entry while recording, and releases them on stop", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const recorder = new StreamRecorder(client, { recordAllTopics: true });

    recorder.start();
    for (const topic of TOPIC_IDS) {
      expect(transport.isSubscribed(topic)).toBe(true);
    }

    recorder.stop();
    for (const topic of TOPIC_IDS) {
      expect(transport.isSubscribed(topic)).toBe(false);
    }
  });

  it("captures stream-data AND event frames verbatim, in arrival order", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    client.subscribe("vessel.orbit", () => {});

    const recorder = new StreamRecorder(client);
    recorder.start();

    transport.emit("vessel.orbit", { sma: 1 }, { validAt: 0, deliveredAt: 0 });
    const eventMessage: ServerMessage = {
      type: "event",
      topic: "vessel.orbit",
      name: "timeline-reset",
      meta: makeMeta({ validAt: 1, deliveredAt: 1 }),
    };
    transport.emitRaw(eventMessage);
    transport.emit("vessel.orbit", { sma: 2 }, { validAt: 2, deliveredAt: 2 });

    const fixture = recorder.stop();
    expect(fixture.frames).toHaveLength(3);
    const parsed = fixture.frames.map(
      (raw) => JSON.parse(raw) as ServerMessage,
    );
    expect(parsed[0].type).toBe("stream-data");
    expect(parsed[1]).toEqual(eventMessage);
    expect(parsed[2].type).toBe("stream-data");
  });

  it("frameCount/latestUt track the in-progress session", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    client.subscribe("vessel.orbit", () => {});
    const recorder = new StreamRecorder(client);

    expect(recorder.recording).toBe(false);
    recorder.start();
    expect(recorder.recording).toBe(true);
    expect(recorder.frameCount).toBe(0);
    expect(recorder.latestUt).toBe(0);

    transport.emit("vessel.orbit", { sma: 1 }, { validAt: 10 });
    expect(recorder.frameCount).toBe(1);
    expect(recorder.latestUt).toBe(10);

    transport.emit("vessel.orbit", { sma: 2 }, { validAt: 5 }); // out of order — latestUt never regresses
    expect(recorder.frameCount).toBe(2);
    expect(recorder.latestUt).toBe(10);

    recorder.stop();
    expect(recorder.recording).toBe(false);
  });

  it("a captured fixture round-trips through ReplayTransport to the same TimelineStore state", () => {
    const transport = new StubTransport();
    const recordingClient = new TelemetryClient(transport);
    recordingClient.subscribe("vessel.orbit", () => {});

    const recorder = new StreamRecorder(recordingClient);
    recorder.start();
    transport.emit(
      "vessel.orbit",
      { sma: 700_000 },
      { validAt: 0, deliveredAt: 0 },
    );
    transport.emit(
      "vessel.orbit",
      { sma: 750_000 },
      { validAt: 5, deliveredAt: 5 },
    );
    const fixture = recorder.stop();

    const clock = new FakeClock();
    const replayTransport = new ReplayTransport(fixture, { clock });
    const replayClient = new TelemetryClient(replayTransport);
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    replayClient.attachStore(store);
    replayClient.subscribe("vessel.orbit", () => {});

    clock.advanceTo(0);
    store.beginFrame();
    expect(store.sample<{ sma: number }>("vessel.orbit")?.payload.sma).toBe(
      700_000,
    );

    clock.advanceTo(5);
    store.beginFrame();
    expect(store.sample<{ sma: number }>("vessel.orbit")?.payload.sma).toBe(
      750_000,
    );
  });
});
