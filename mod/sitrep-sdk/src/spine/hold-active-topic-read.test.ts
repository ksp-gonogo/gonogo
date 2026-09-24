import { afterEach, describe, expect, it } from "vitest";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import {
  holdActiveTopicRead,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
} from "./context";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/** A real client over a stub socket, asked only what it has subscribed. */
function countingClient() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  return {
    client,
    count: (topic: string) => (transport.isSubscribed(topic) ? 1 : 0),
  };
}

function store(): TimelineStore {
  return new TimelineStore(
    new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
  );
}

afterEach(() => {
  setActiveTelemetryClientForTests(undefined);
  setActiveTimelineStoreForTests(undefined);
});

describe("holdActiveTopicRead", () => {
  it("waits for a provider, and subscribes the moment one arrives", () => {
    const { client, count } = countingClient();
    const release = holdActiveTopicRead("vessel.flight.altitudeAsl");
    expect(count("vessel.flight")).toBe(0);

    setActiveTimelineStoreForTests(store());
    setActiveTelemetryClientForTests(client);

    expect(count("vessel.flight")).toBe(1);
    release();
    expect(count("vessel.flight")).toBe(0);
  });

  it("moves to a provider that remounts with a new client", () => {
    const first = countingClient();
    const second = countingClient();
    setActiveTimelineStoreForTests(store());
    setActiveTelemetryClientForTests(first.client);
    const release = holdActiveTopicRead("vessel.flight");
    expect(first.count("vessel.flight")).toBe(1);

    setActiveTelemetryClientForTests(undefined);
    expect(first.count("vessel.flight")).toBe(0);

    setActiveTelemetryClientForTests(second.client);
    expect(second.count("vessel.flight")).toBe(1);
    release();
    expect(second.count("vessel.flight")).toBe(0);
  });

  it("subscribes nothing against a store double that cannot resolve topics", () => {
    const { client, count } = countingClient();
    const bare = store();
    setActiveTimelineStoreForTests({
      sample: bare.sample.bind(bare),
      sampleReading: bare.sampleReading.bind(bare),
      currentFrame: bare.currentFrame.bind(bare),
      subscribeFrame: bare.subscribeFrame.bind(bare),
    });
    setActiveTelemetryClientForTests(client);

    const release = holdActiveTopicRead("vessel.flight");
    expect(count("vessel.flight")).toBe(0);
    release();
  });
});
