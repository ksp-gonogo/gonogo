import { describe, expect, it } from "vitest";
import type { Transport, TransportStatus } from "../api/transport";
import type { ClientMessage, ServerMessage } from "../envelope";
import { makeMeta } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import type { Clock } from "./clock";

const FROZEN_CLOCK: Clock = {
  now: () => 100,
  schedule: () => () => {},
};

class RecordingTransport implements Transport {
  status: TransportStatus = "connected";
  readonly sent: ClientMessage[] = [];
  private readonly messages = new Set<(m: ServerMessage) => void>();

  send(message: ClientMessage) {
    this.sent.push(message);
  }
  onMessage(listener: (m: ServerMessage) => void) {
    this.messages.add(listener);
    return () => this.messages.delete(listener);
  }
  onStatusChange() {
    return () => {};
  }
  deliver(message: ServerMessage) {
    for (const listener of this.messages) listener(message);
  }
  get commands() {
    return this.sent.filter((m) => m.type === "command-request");
  }
}

function setup() {
  const transport = new RecordingTransport();
  const client = new TelemetryClient(transport, FROZEN_CLOCK, {
    idPrefix: "p",
  });
  client.setDelaySource(() => 0);
  return { transport, client };
}

function send(client: TelemetryClient) {
  const sent = client.dispatch("vessel.control.stage", {});
  sent.result.catch(() => undefined);
  return sent;
}

describe("a command names the vessel the operator last saw", () => {
  it("carries the vessel id of the newest vessel.identity reading", () => {
    const { transport, client } = setup();
    client.subscribe("vessel.identity", () => {});
    transport.deliver({
      type: "stream-data",
      topic: "vessel.identity",
      payload: { vesselId: "aaaa" },
      meta: makeMeta(),
    });

    send(client);

    expect(transport.commands[0]).toMatchObject({ seenVesselId: "aaaa" });
  });

  it("states no vessel before any vessel.identity reading has arrived", () => {
    const { transport, client } = setup();

    send(client);

    expect(transport.commands[0]).not.toHaveProperty("seenVesselId");
  });
});
