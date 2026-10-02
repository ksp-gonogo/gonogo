import { describe, expect, it } from "vitest";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";

/**
 * A late sample never becomes a topic's latest value. Under routed delivery a
 * span can arrive behind data already shown, and its older `comms.delay`
 * taken as current would pull the view clock back and freeze every delayed
 * readout. The timelines still receive it, in order.
 */
describe("TelemetryClient's latest value never goes backwards", () => {
  function harness() {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const seen: unknown[] = [];
    client.subscribe("comms.delay", (payload) => seen.push(payload));
    return { transport, client, seen };
  }

  it("keeps the newer value when an older sample arrives after it", () => {
    const { transport, client, seen } = harness();
    transport.emit(
      "comms.delay",
      { marker: "new" },
      { validAt: 20, vantage: "ground:ksc" },
    );
    transport.emit(
      "comms.delay",
      { marker: "old" },
      { validAt: 5, vantage: "ground:ksc" },
    );

    expect(seen).toHaveLength(1);
    expect(client.getValue("comms.delay")).toMatchObject({ marker: "new" });
  });

  it("takes a sample at the same instant", () => {
    const { transport, client } = harness();
    transport.emit(
      "comms.delay",
      { marker: "a" },
      { validAt: 20, vantage: "ground:ksc" },
    );
    transport.emit(
      "comms.delay",
      { marker: "b" },
      { validAt: 20, vantage: "ground:ksc" },
    );

    expect(client.getValue("comms.delay")).toMatchObject({ marker: "b" });
  });

  it("starts afresh on a new timeline epoch, where an earlier instant is the newest", () => {
    const { transport, client } = harness();
    transport.emit(
      "comms.delay",
      { marker: "before" },
      { validAt: 20, timelineEpoch: 0, vantage: "ground:ksc" },
    );
    transport.emit(
      "comms.delay",
      { marker: "after" },
      { validAt: 5, timelineEpoch: 1, vantage: "ground:ksc" },
    );

    expect(client.getValue("comms.delay")).toMatchObject({ marker: "after" });
  });

  it("starts afresh on a new vantage, which may know only an earlier instant", () => {
    const { transport, client } = harness();
    transport.emit(
      "comms.delay",
      { marker: "near" },
      { validAt: 20, vantage: "ground:ksc" },
    );
    transport.emit(
      "comms.delay",
      { marker: "far" },
      { validAt: 5, vantage: "vessel:far-centre" },
    );

    expect(client.getValue("comms.delay")).toMatchObject({ marker: "far" });
  });

  it("an LOS revealed after the AOS that followed it never replaces the AOS", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    client.subscribe("comms.link", () => {});
    transport.emit(
      "comms.link",
      { connected: true },
      { validAt: 105, vantage: "ground:ksc" },
    );
    transport.emit(
      "comms.link",
      { connected: false },
      { validAt: 100, vantage: "ground:ksc" },
    );

    expect(client.getValue("comms.link")).toMatchObject({ connected: true });
  });
});
