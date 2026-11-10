import { describe, expect, it } from "vitest";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function setup() {
  const store = new TimelineStore(
    new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    }),
  );
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  client.attachStore(store);
  client.subscribe("v.alt", () => {});
  return { store, transport, client };
}

describe("TimelineStore.dataRevision", () => {
  it("stands still across frames with nothing stored", () => {
    const { store, transport, client } = setup();
    transport.emit("v.alt", 1, { validAt: 1 });
    const before = store.dataRevision();
    store.beginFrame();
    store.beginFrame();
    expect(store.dataRevision()).toBe(before);
    client.dispose();
  });

  it("moves when a sample is stored", () => {
    const { store, transport, client } = setup();
    transport.emit("v.alt", 1, { validAt: 1 });
    const before = store.dataRevision();
    transport.emit("v.alt", 2, { validAt: 2 });
    expect(store.dataRevision()).toBeGreaterThan(before);
    client.dispose();
  });

  it("moves when a derived channel is registered", () => {
    const { store, client } = setup();
    const before = store.dataRevision();
    store.registerDerivedChannel({
      topic: "v.derived",
      inputs: ["v.alt"],
      derive: () => 0,
    });
    expect(store.dataRevision()).toBeGreaterThan(before);
    client.dispose();
  });
});
