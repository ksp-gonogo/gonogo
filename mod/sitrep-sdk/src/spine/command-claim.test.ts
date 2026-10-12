import { describe, expect, it } from "vitest";
import { FaultCode } from "../__generated__/error-codes";
import type { Transport, TransportStatus } from "../api/transport";
import type { ClientMessage, ServerMessage } from "../envelope";
import { makeMeta } from "../testing/stub-transport";
import {
  type OutstandingCommand,
  type OutstandingCommandStore,
  TelemetryClient,
} from "./client";
import type { Clock } from "./clock";

const FROZEN_CLOCK: Clock = {
  now: () => 100,
  schedule: () => () => {},
};

class MemoryStore implements OutstandingCommandStore {
  held: readonly OutstandingCommand[] = [];
  read() {
    return this.held;
  }
  write(commands: readonly OutstandingCommand[]) {
    this.held = commands;
  }
}

class FakeModTransport implements Transport {
  status: TransportStatus;
  readonly claimsAnswers: boolean;
  readonly sent: ClientMessage[] = [];
  private readonly messages = new Set<(m: ServerMessage) => void>();
  private readonly statuses = new Set<(s: TransportStatus) => void>();

  constructor(options: { claimsAnswers?: boolean; connected?: boolean } = {}) {
    this.claimsAnswers = options.claimsAnswers ?? true;
    this.status = options.connected === false ? "reconnecting" : "connected";
  }

  send(message: ClientMessage) {
    this.sent.push(message);
  }
  onMessage(listener: (m: ServerMessage) => void) {
    this.messages.add(listener);
    return () => this.messages.delete(listener);
  }
  onStatusChange(listener: (s: TransportStatus) => void) {
    this.statuses.add(listener);
    return () => this.statuses.delete(listener);
  }
  setStatus(status: TransportStatus) {
    this.status = status;
    for (const listener of this.statuses) listener(status);
  }
  deliver(message: ServerMessage) {
    for (const listener of this.messages) listener(message);
  }
  get claims() {
    return this.sent.filter((m) => m.type === "claim");
  }
}

function newClient(
  transport: Transport,
  store: OutstandingCommandStore | undefined,
  idPrefix = "p",
) {
  const client = new TelemetryClient(transport, FROZEN_CLOCK, {
    idPrefix,
    outstanding: store,
  });
  client.setDelaySource(() => 0);
  return client;
}

/** Dispatches with the promise's rejection marked handled, as a caller that does not await it would. */
function send(
  client: TelemetryClient,
  ...args: Parameters<TelemetryClient["dispatch"]>
) {
  const sent = client.dispatch(...args);
  sent.result.catch(() => undefined);
  return sent;
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("a client claims the answers to commands it still waits on", () => {
  it("stores a command while it is outstanding and forgets it once it is answered", () => {
    const store = new MemoryStore();
    const transport = new FakeModTransport();
    const client = newClient(transport, store);

    const { requestId } = send(client, "x.y", { n: 1 }, "Do it");
    expect(store.held.map((c) => c.requestId)).toEqual([requestId]);
    expect(store.held[0]).toMatchObject({
      command: "x.y",
      args: { n: 1 },
      label: "Do it",
    });

    transport.deliver({
      type: "command-response",
      requestId,
      result: "ok",
      meta: makeMeta(),
    });
    expect(store.held).toEqual([]);
  });

  it("claims what an earlier page left outstanding and is answered by it", async () => {
    const store = new MemoryStore();
    const before = newClient(new FakeModTransport(), store, "old");
    const { requestId } = send(before, "x.y", { n: 1 }, "Do it");
    before.dispose();

    const transport = new FakeModTransport();
    const after = newClient(transport, store, "new");
    expect(after.getCommand(requestId).phase).toBe("in-flight");
    expect(transport.claims).toEqual([]);
    await flush();
    expect(transport.claims).toEqual([
      { type: "claim", requestIds: [requestId] },
    ]);

    transport.deliver({
      type: "command-response",
      requestId,
      result: "ran",
      meta: makeMeta(),
    });
    expect(after.getCommand(requestId)).toMatchObject({
      phase: "confirmed",
      result: "ran",
    });
    expect(store.held).toEqual([]);
  });

  it("claims again, after the vantage is re-sent, whenever the connection comes back", async () => {
    const transport = new FakeModTransport();
    const client = newClient(transport, undefined);
    const { requestId } = send(client, "x.y");
    transport.setStatus("reconnecting");
    await flush();
    expect(transport.claims).toEqual([]);

    transport.setStatus("connected");
    transport.send({ type: "set-vantage", centreId: "ksc" });
    await flush();
    const types = transport.sent.map((m) => m.type);
    expect(types.indexOf("claim")).toBeGreaterThan(
      types.indexOf("set-vantage"),
    );
    expect(transport.claims).toEqual([
      { type: "claim", requestIds: [requestId] },
    ]);
  });

  it("sends no claim when nothing is outstanding", async () => {
    const transport = new FakeModTransport();
    newClient(transport, undefined);
    transport.setStatus("connected");
    await flush();
    expect(transport.claims).toEqual([]);
  });

  it("calls a command lost, and stops claiming it, when the mod holds nothing for it", async () => {
    const store = new MemoryStore();
    const transport = new FakeModTransport();
    const client = newClient(transport, store);
    const { requestId } = send(client, "x.y");

    transport.deliver({
      type: "error",
      requestId,
      code: FaultCode.ReplyNotReceived,
      message: "the game holds no answer for that request",
    });

    expect(client.getCommand(requestId).phase).toBe("lost");
    expect(store.held).toEqual([]);
    transport.setStatus("connected");
    await flush();
    expect(transport.claims).toEqual([]);
  });

  it("hands each restored command to one caller, by command", () => {
    const store = new MemoryStore();
    const before = newClient(new FakeModTransport(), store, "old");
    send(before, "x.y", { n: 1 }, "One");
    send(before, "x.z", { n: 2 }, "Two");
    before.dispose();

    const after = newClient(new FakeModTransport(), store, "new");
    expect(after.restoredCommands("x.y")).toMatchObject([
      { args: { n: 1 }, label: "One" },
    ]);
    expect(after.restoredCommands("x.y")).toEqual([]);
    expect(after.restoredCommands("x.z")).toHaveLength(1);
  });

  it("neither stores nor claims on a transport that cannot claim", async () => {
    const store = new MemoryStore();
    const transport = new FakeModTransport({ claimsAnswers: false });
    const client = newClient(transport, store);
    send(client, "x.y");
    transport.setStatus("connected");
    await flush();
    expect(store.held).toEqual([]);
    expect(transport.claims).toEqual([]);
  });
});
