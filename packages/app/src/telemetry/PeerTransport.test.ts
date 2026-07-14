import { TelemetryClient } from "@ksp-gonogo/sitrep-client";
import type { Meta, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { Quality, Staleness } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it, vi } from "vitest";
import type { ConnStatus, PeerClientService } from "../peer/PeerClientService";
import { PeerTransport } from "./PeerTransport";

/**
 * Duck-typed fake of the `PeerClientService` surface `PeerTransport`
 * actually touches — mirrors `WebSocketTransport.test.ts`'s injected-socket
 * pattern (a scriptable stand-in for the real transport-side dependency),
 * scoped to `PeerTransport`'s narrow needs rather than pulling in real
 * PeerJS.
 */
function makeFakeClient(initialStatus: ConnStatus = "connected") {
  const frameListeners = new Set<(message: ServerMessage) => void>();
  const responseListeners = new Set<
    (requestId: string, result: unknown, meta: Meta) => void
  >();
  const errorListeners = new Set<
    (requestId: string, code: string, message: string) => void
  >();
  const statusListeners = new Set<(status: ConnStatus) => void>();
  const sentCommands: Array<{
    requestId: string;
    command: string;
    args: unknown;
  }> = [];

  const fake = {
    getConnStatus: () => initialStatus,
    onSitrepFrame: (cb: (message: ServerMessage) => void) => {
      frameListeners.add(cb);
      return () => frameListeners.delete(cb);
    },
    onSitrepCommandResponse: (
      cb: (requestId: string, result: unknown, meta: Meta) => void,
    ) => {
      responseListeners.add(cb);
      return () => responseListeners.delete(cb);
    },
    onSitrepCommandError: (
      cb: (requestId: string, code: string, message: string) => void,
    ) => {
      errorListeners.add(cb);
      return () => errorListeners.delete(cb);
    },
    onConnectionStatus: (cb: (status: ConnStatus) => void) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    sendSitrepCommand: (requestId: string, command: string, args: unknown) => {
      sentCommands.push({ requestId, command, args });
    },
    // Test-only helpers to drive the fake from outside — not part of the
    // real PeerClientService surface PeerTransport reads.
    emitFrame(message: ServerMessage) {
      for (const cb of frameListeners) cb(message);
    },
    emitCommandResponse(requestId: string, result: unknown, meta: Meta) {
      for (const cb of responseListeners) cb(requestId, result, meta);
    },
    emitCommandError(requestId: string, code: string, message: string) {
      for (const cb of errorListeners) cb(requestId, code, message);
    },
    emitStatus(status: ConnStatus) {
      for (const cb of statusListeners) cb(status);
    },
    sentCommands,
  };
  return fake;
}

function makeMeta(overrides: Partial<Meta> = {}): Meta {
  return {
    source: "test",
    validAt: 0,
    seq: 0,
    deliveredAt: 0,
    vantage: "test",
    quality: Quality.OnRails,
    active: false,
    staleness: Staleness.Fresh,
    timelineEpoch: 0,
    ...overrides,
  };
}

describe("PeerTransport", () => {
  it("reads the initial status from client.getConnStatus() at construction", () => {
    const connected = makeFakeClient("connected");
    expect(
      new PeerTransport(connected as unknown as PeerClientService).status,
    ).toBe("connected");

    const idle = makeFakeClient("idle");
    expect(new PeerTransport(idle as unknown as PeerClientService).status).toBe(
      "reconnecting",
    );

    const connecting = makeFakeClient("connecting");
    expect(
      new PeerTransport(connecting as unknown as PeerClientService).status,
    ).toBe("reconnecting");

    const reconnecting = makeFakeClient("reconnecting");
    expect(
      new PeerTransport(reconnecting as unknown as PeerClientService).status,
    ).toBe("reconnecting");

    const disconnected = makeFakeClient("disconnected");
    expect(
      new PeerTransport(disconnected as unknown as PeerClientService).status,
    ).toBe("disconnected");
  });

  it("forwards status changes to onStatusChange listeners", () => {
    const client = makeFakeClient("reconnecting");
    const transport = new PeerTransport(client as unknown as PeerClientService);
    const statuses: string[] = [];
    transport.onStatusChange((s) => statuses.push(s));

    client.emitStatus("connected");
    client.emitStatus("connected"); // no-op — same status, must not re-fire
    client.emitStatus("disconnected");

    expect(statuses).toEqual(["connected", "disconnected"]);
    expect(transport.status).toBe("disconnected");
  });

  it("fans out a relayed stream-data frame to onMessage listeners verbatim", () => {
    const client = makeFakeClient();
    const transport = new PeerTransport(client as unknown as PeerClientService);
    const received: ServerMessage[] = [];
    transport.onMessage((m) => received.push(m));

    const frame: ServerMessage = {
      type: "stream-data",
      topic: "vessel.orbit",
      payload: { apoapsis: 100_000 },
      meta: makeMeta({ validAt: 42, deliveredAt: 43 }),
    };
    client.emitFrame(frame);

    expect(received).toEqual([frame]);
  });

  it("synthesizes a bare command-response ServerMessage from onSitrepCommandResponse", () => {
    const client = makeFakeClient();
    const transport = new PeerTransport(client as unknown as PeerClientService);
    const received: ServerMessage[] = [];
    transport.onMessage((m) => received.push(m));

    const meta = makeMeta();
    client.emitCommandResponse("c0", { ok: true }, meta);

    expect(received).toEqual([
      { type: "command-response", requestId: "c0", result: { ok: true }, meta },
    ]);
  });

  it("synthesizes a bare error ServerMessage from onSitrepCommandError", () => {
    const client = makeFakeClient();
    const transport = new PeerTransport(client as unknown as PeerClientService);
    const received: ServerMessage[] = [];
    transport.onMessage((m) => received.push(m));

    client.emitCommandError("c0", "E_LOST", "no confirmation");

    expect(received).toEqual([
      {
        type: "error",
        requestId: "c0",
        code: "E_LOST",
        message: "no confirmation",
      },
    ]);
  });

  it("send() routes a command-request to client.sendSitrepCommand", () => {
    const client = makeFakeClient();
    const transport = new PeerTransport(client as unknown as PeerClientService);

    transport.send({
      type: "command-request",
      requestId: "c3",
      command: "vessel.control.setSas",
      label: "",
      topic: "",
      args: { enabled: true },
      sentAt: 0,
    });

    expect(client.sentCommands).toEqual([
      {
        requestId: "c3",
        command: "vessel.control.setSas",
        args: { enabled: true },
      },
    ]);
  });

  it("send() is a no-op on the wire for subscribe/unsubscribe", () => {
    const client = makeFakeClient();
    const transport = new PeerTransport(client as unknown as PeerClientService);

    transport.send({ type: "subscribe", topic: "vessel.orbit" });
    transport.send({ type: "unsubscribe", topic: "vessel.orbit" });

    expect(client.sentCommands).toEqual([]);
  });

  it("dispose() detaches every listener so later client events are ignored", () => {
    const client = makeFakeClient();
    const transport = new PeerTransport(client as unknown as PeerClientService);
    const received: ServerMessage[] = [];
    transport.onMessage((m) => received.push(m));
    const statuses: string[] = [];
    transport.onStatusChange((s) => statuses.push(s));

    transport.dispose();

    client.emitFrame({
      type: "stream-data",
      topic: "vessel.orbit",
      payload: {},
      meta: makeMeta(),
    });
    client.emitStatus("disconnected");

    expect(received).toEqual([]);
    expect(statuses).toEqual([]);
  });

  it("isolates a throwing onMessage listener from sibling listeners", () => {
    const client = makeFakeClient();
    const transport = new PeerTransport(client as unknown as PeerClientService);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const received: ServerMessage[] = [];
    transport.onMessage(() => {
      throw new Error("boom");
    });
    transport.onMessage((m) => received.push(m));

    const frame: ServerMessage = {
      type: "stream-data",
      topic: "vessel.orbit",
      payload: {},
      meta: makeMeta(),
    };
    client.emitFrame(frame);

    expect(received).toEqual([frame]);
    consoleError.mockRestore();
  });

  it("end-to-end: a TelemetryClient.dispatch() over PeerTransport resolves when the host's command-response arrives", async () => {
    const client = makeFakeClient();
    const transport = new PeerTransport(client as unknown as PeerClientService);
    const telemetryClient = new TelemetryClient(transport);

    const { requestId, result } = telemetryClient.dispatch(
      "vessel.control.setSas",
      { enabled: true },
    );

    expect(client.sentCommands).toEqual([
      { requestId, command: "vessel.control.setSas", args: { enabled: true } },
    ]);

    // Simulate the host relaying back the station's OWN requestId (per
    // protocol.ts's `sitrep-command-request` doc comment: the station's
    // TelemetryClient-minted id IS the correlation key).
    client.emitCommandResponse(requestId, { applied: true }, makeMeta());

    await expect(result).resolves.toEqual({ applied: true });
  });

  it("send() synthesizes an error on a later tick instead of silently dropping a command sent with no live connection", async () => {
    const client = makeFakeClient("disconnected");
    const transport = new PeerTransport(client as unknown as PeerClientService);
    const received: ServerMessage[] = [];
    transport.onMessage((m) => received.push(m));

    transport.send({
      type: "command-request",
      requestId: "c9",
      command: "vessel.control.setSas",
      label: "",
      topic: "",
      args: { enabled: true },
      sentAt: 0,
    });

    // Never reaches PeerClientService.sendSitrepCommand (there's no conn to
    // carry it) and must not settle synchronously within send() itself.
    expect(client.sentCommands).toEqual([]);
    expect(received).toEqual([]);

    await Promise.resolve();
    await Promise.resolve();

    expect(received).toEqual([
      {
        type: "error",
        requestId: "c9",
        code: "E_PEER_DISCONNECTED",
        message: "no active peer connection to the host",
      },
    ]);
  });

  it("fails a command still in flight when the connection drops mid-flight, instead of hanging forever", async () => {
    const client = makeFakeClient("connected");
    const transport = new PeerTransport(client as unknown as PeerClientService);
    const telemetryClient = new TelemetryClient(transport);

    const { result } = telemetryClient.dispatch("vessel.control.setSas", {
      enabled: true,
    });

    // The peer link drops before any command-response/error arrives.
    client.emitStatus("disconnected");

    await expect(result).rejects.toMatchObject({ code: "E_PEER_DISCONNECTED" });
  });

  it("a dropped command that already settled via a real response is not double-settled by a later status drop", async () => {
    const client = makeFakeClient("connected");
    const transport = new PeerTransport(client as unknown as PeerClientService);
    const telemetryClient = new TelemetryClient(transport);

    const { requestId, result } = telemetryClient.dispatch(
      "vessel.control.setSas",
      { enabled: true },
    );
    client.emitCommandResponse(requestId, { applied: true }, makeMeta());
    await expect(result).resolves.toEqual({ applied: true });

    // Must not throw / must not attempt to re-settle an already-resolved
    // promise — TelemetryClient itself no-ops a settle on an unknown or
    // already-terminal requestId, this just proves PeerTransport doesn't
    // keep re-delivering for it either.
    const received: ServerMessage[] = [];
    transport.onMessage((m) => received.push(m));
    client.emitStatus("disconnected");
    expect(received).toEqual([]);
  });
});
