/**
 * A command the mod REFUSES must reach a station as a refusal, with the reason
 * the mod gave and the numbers behind it.
 *
 * The mod answers a refusal on the RESPONSE channel (`CommandResult` with
 * `success: false`), and the host's own `TelemetryClient` turns that into a
 * `CommandError` carrying `errorCode`/`breach`/`detail`. Relaying that rejection
 * as a `sitrep-command-error` kept only `code` and `message`, so a station saw a
 * bare `failed` with `errorCode: Unknown` and no numbers, where the host
 * operator sitting next to them saw "the VAB holds 140 t and this is 210 t".
 *
 * Exercises the real `PeerHostService`/`PeerClientService`/`PeerTransport` stack
 * over a fake PeerJS data channel (the `FakeHub` pattern
 * `sitrep-command-label-topic-tunnel.test.ts` and `kos-execute-tunnel.test.ts`
 * both use), with a real `TelemetryClient` on BOTH ends: the host's backed by a
 * `StubTransport` standing in for the mod, the station's backed by the
 * `PeerTransport` it uses in production. So the refusal is observed where an
 * operator would meet it, on the station's own command status and its own
 * dispatch rejection, rather than on a wire message a test read for them.
 */

import {
  StubTransport,
  setActiveTelemetryClientForTests,
  TelemetryClient,
} from "@ksp-gonogo/sitrep-client";
import {
  CommandErrorCode,
  classifyCommandRejection,
  isValue,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

const { FakeHub } = vi.hoisted(() => {
  class FakeDataConnection {
    static all: FakeDataConnection[] = [];
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    peer: string;
    peerConn: FakeDataConnection | null = null;
    open = true;

    constructor(peer: string) {
      this.peer = peer;
      FakeDataConnection.all.push(this);
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }

    send(msg: unknown) {
      queueMicrotask(() => {
        // PeerJS serialises, so the far side never receives the sender's own
        // object: a `Value`'s two fields cross and its prototype does not.
        // Cloning here is what makes this fake capable of showing that, rather
        // than handing the station a live object it could not have received.
        this.peerConn?.emit("data", structuredClone(msg));
      });
    }

    close() {
      this.open = false;
    }
  }

  class FakePeer {
    static registry = new Map<string, FakePeer>();
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    id: string;

    constructor(id?: string) {
      this.id = id ?? `peer-${Math.random().toString(36).slice(2, 10)}`;
      FakePeer.registry.set(this.id, this);
      queueMicrotask(() => this.emit("open", this.id));
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }

    connect(hostId: string) {
      const host = FakePeer.registry.get(hostId);
      if (!host) throw new Error(`host ${hostId} not registered`);
      const stationOutbound = new FakeDataConnection(hostId);
      const hostInbound = new FakeDataConnection(this.id);
      stationOutbound.peerConn = hostInbound;
      hostInbound.peerConn = stationOutbound;
      queueMicrotask(() => {
        host.emit("connection", hostInbound);
        hostInbound.emit("open");
        stationOutbound.emit("open");
      });
      return stationOutbound;
    }

    destroy() {}
  }

  return {
    FakeHub: {
      Peer: FakePeer,
      reset() {
        FakePeer.registry.clear();
        FakeDataConnection.all = [];
      },
    },
  };
});

vi.mock("peerjs", () => ({ default: FakeHub.Peer }));

const localStorageMock = {
  store: new Map<string, string>(),
  getItem(k: string) {
    return this.store.get(k) ?? null;
  },
  setItem(k: string, v: string) {
    this.store.set(k, v);
  },
  removeItem(k: string) {
    this.store.delete(k);
  },
  clear() {
    this.store.clear();
  },
};
vi.stubGlobal("localStorage", localStorageMock);

import { PeerClientService } from "../peer/PeerClientService";
import { PeerHostService } from "../peer/PeerHostService";
import { PeerTransport } from "../telemetry/PeerTransport";

/** Drain the queued-microtask chain the fake channel and the stub both hop on. */
async function settleWire(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

/**
 * A refusal with every optional half populated, because the defect was that the
 * optional halves were the ones that vanished: `code` and `message` always
 * crossed.
 */
const BREACH = {
  facility: "VehicleAssemblyBuilding",
  facilityName: "Vehicle Assembly Building",
  facilityLevel: value("ratio", 1),
  quantity: "mass",
  limit: 140,
  actual: 210,
  unit: "t",
};
const DETAIL = "vessel mass exceeds the building's limit";

/**
 * Stand up the whole station -> host -> mod -> station loop with the mod
 * refusing, and return everything the two ends can be asked about.
 */
async function refusedRoundTrip() {
  const modTransport = new StubTransport();
  const hostClient = new TelemetryClient(modTransport);
  modTransport.setCommandHandler(() => ({
    success: false,
    errorCode: CommandErrorCode.LimitReached,
    breach: BREACH,
    detail: DETAIL,
  }));
  setActiveTelemetryClientForTests(hostClient);

  const host = new PeerHostService();
  await host.start();
  await Promise.resolve();

  const peerClient = new PeerClientService();
  peerClient.connect(host.peerId ?? "");
  await settleWire();

  const errorFrames: Array<{ code: string; message: string }> = [];
  peerClient.onSitrepCommandError((_requestId, code, message) => {
    errorFrames.push({ code, message });
  });

  const transport = new PeerTransport(peerClient);
  const stationClient = new TelemetryClient(transport);
  const { requestId, result } = stationClient.dispatch(
    "rp1.facility.upgrade",
    { facility: "VehicleAssemblyBuilding" },
    "Upgrade Vehicle Assembly Building",
  );
  const rejection = result.catch((err: unknown) => err);
  await settleWire();

  return {
    errorFrames,
    requestId,
    rejection,
    stationClient,
    status: stationClient.getCommand(requestId),
  };
}

describe("a refused command crossing the peer boundary", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
    setActiveTelemetryClientForTests(undefined);
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  it("settles a station's command as refused, with the mod's typed reason and its numbers", async () => {
    const { status, requestId } = await refusedRoundTrip();

    expect(status).toMatchObject({
      phase: "refused",
      requestId,
      errorCode: CommandErrorCode.LimitReached,
      detail: DETAIL,
      breach: {
        facilityName: "Vehicle Assembly Building",
        quantity: "mass",
        limit: 140,
        actual: 210,
        unit: "t",
      },
      /*
       * Filled from the station's own pending record, so the refusal can be
       * SAID ("Upgrade Vehicle Assembly Building refused: ..."), not only
       * classified.
       */
      command: "rp1.facility.upgrade",
      label: "Upgrade Vehicle Assembly Building",
    });
  });

  it("rejects the dispatch with a rejection that still classifies as refused, in full", async () => {
    const { rejection } = await refusedRoundTrip();

    /*
     * What `useCommand` reads to build its refusal list, and therefore what
     * decides the sentence an operator is shown. `errorCode: Unknown` with no
     * breach is a true classification of a lost reason, and the sentence it
     * produces is the generic one.
     */
    expect(classifyCommandRejection(await rejection)).toMatchObject({
      kind: "refused",
      errorCode: CommandErrorCode.LimitReached,
      detail: DETAIL,
      breach: { limit: 140, actual: 210, unit: "t" },
    });
  });

  it("keeps a breach's quantities usable after the hop, not two fields with no prototype", async () => {
    const { status } = await refusedRoundTrip();

    const breach = (status as { breach?: { facilityLevel?: unknown } }).breach;
    /*
     * A `Value` is two fields plus a prototype and only the fields cross a
     * PeerJS hop, so a breach relayed raw renders fine and throws on the first
     * method call, inside a component body.
     */
    expect(isValue(breach?.facilityLevel)).toBe(true);
  });

  it("never sends a refusal down the error channel", async () => {
    const { errorFrames } = await refusedRoundTrip();

    /*
     * The wrong design, pinned. A refusal relayed as `sitrep-command-error`
     * carries `code` and `message` and nothing else, which is how the typed
     * reason was lost in the first place; widening that message instead would
     * put the refusal on the channel whose whole content is "the machinery
     * broke", and leave the station's `handleCommandError` to grow a
     * code-specific exception to reach `refused`.
     *
     * The mod refuses on the response channel. So does the host.
     */
    expect(errorFrames).toEqual([]);
  });

  it("still relays a genuine host-side failure as an error, settling failed", async () => {
    // No host `TelemetryClient` at all: nothing was dispatched and nothing was
    // refused, so this must stay on the error channel and stay `failed`.
    setActiveTelemetryClientForTests(undefined);

    const host = new PeerHostService();
    await host.start();
    await Promise.resolve();

    const peerClient = new PeerClientService();
    peerClient.connect(host.peerId ?? "");
    await settleWire();

    const transport = new PeerTransport(peerClient);
    const stationClient = new TelemetryClient(transport);
    const { requestId, result } = stationClient.dispatch(
      "rp1.facility.upgrade",
      { facility: "VehicleAssemblyBuilding" },
    );
    const rejection = result.catch((err: unknown) => err);
    await settleWire();

    expect(stationClient.getCommand(requestId)).toMatchObject({
      phase: "failed",
      error: { code: "E_NO_CLIENT" },
    });
    expect(classifyCommandRejection(await rejection)).toMatchObject({
      kind: "failed",
      code: "E_NO_CLIENT",
    });
  });
});
