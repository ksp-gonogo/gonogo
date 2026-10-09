/**
 * A station that joins while the game is at its main menu, or mid-load, shows
 * the game's state at once and follows each change after it.
 *
 * Real `PeerHostService`, `PeerClientService`, `SitrepPeerRelay`,
 * `PeerTransport` and `TelemetryClient` over an in-process PeerJS stand-in; the
 * host's link to the mod is a `StubTransport`.
 */

// ---------------------------------------------------------------------------
// Fake PeerJS: bidirectional in-process mock (adapted from the retired
// recorded-fixture harness at `cb96f069^`). Two `FakePeer`s in the same
// process find each other by id through `peerRegistry`; `peer.connect(id)`
// pairs `FakeDataConnection`s so `send()` on one side lands in the other's
// `"data"` listener: close enough to real PeerJS to exercise the real
// `PeerHostService`/`PeerClientService` classes without any WebRTC.
// ---------------------------------------------------------------------------
const peerRegistry = vi.hoisted(
  () =>
    new Map<
      string,
      { emit: (event: string, ...args: unknown[]) => void; destroyed: boolean }
    >(),
);

vi.mock("peerjs", () => {
  type Listener = (...args: unknown[]) => void;

  class FakeDataConnection {
    peer: string;
    open = false;
    private listeners = new Map<string, Listener[]>();
    private remote: FakeDataConnection | null = null;

    constructor(remotePeerId: string) {
      this.peer = remotePeerId;
    }

    on(event: string, cb: Listener): this {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      this.listeners
        .get(event)
        ?.slice()
        .forEach((cb) => {
          cb(...args);
        });
    }

    pair(remote: FakeDataConnection) {
      this.remote = remote;
      remote.remote = this;
    }

    markOpen() {
      this.open = true;
      queueMicrotask(() => this.emit("open"));
    }

    send(data: unknown) {
      if (!this.remote) return;
      const copy = structuredClone(data);
      queueMicrotask(() => this.remote?.emit("data", copy));
    }

    close() {
      if (!this.open) return;
      this.open = false;
      this.emit("close");
      this.remote?.emit("close");
    }
  }

  class FakePeer {
    id: string;
    open = false;
    destroyed = false;
    private listeners = new Map<string, Listener[]>();

    constructor(id?: string) {
      this.id =
        typeof id === "string" && id.length > 0
          ? id
          : `STN-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      peerRegistry.set(this.id, {
        emit: (event, ...args) => this.emit(event, ...args),
        destroyed: false,
      });
      queueMicrotask(() => {
        if (this.destroyed) return;
        this.open = true;
        this.emit("open", this.id);
      });
    }

    on(event: string, cb: Listener): this {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      this.listeners
        .get(event)
        ?.slice()
        .forEach((cb) => {
          cb(...args);
        });
    }

    connect(otherId: string): FakeDataConnection {
      const localConn = new FakeDataConnection(otherId);
      queueMicrotask(() => {
        const remote = peerRegistry.get(otherId);
        if (!remote || remote.destroyed) {
          localConn.emit("error", new Error(`peer ${otherId} not found`));
          return;
        }
        const remoteConn = new FakeDataConnection(this.id);
        localConn.pair(remoteConn);
        remote.emit("connection", remoteConn);
        queueMicrotask(() => {
          localConn.markOpen();
          remoteConn.markOpen();
        });
      });
      return localConn;
    }

    reconnect() {}

    destroy() {
      this.destroyed = true;
      const ctx = peerRegistry.get(this.id);
      if (ctx) ctx.destroyed = true;
      peerRegistry.delete(this.id);
    }
  }

  return { default: FakePeer };
});

import {
  TelemetryClient,
  TelemetryProvider,
  useGameStatus,
} from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeerClientService } from "../peer/PeerClientService";
import { PeerHostService } from "../peer/PeerHostService";
import { PeerTransport } from "../telemetry/PeerTransport";
import { SitrepPeerRelay } from "../telemetry/SitrepPeerRelay";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";

function GameStatusProbe({ testId }: { testId: string }) {
  const { state, scene } = useGameStatus();
  return <div data-testid={testId}>{`${state}|${scene}`}</div>;
}

function HostApp({
  client,
  peerHost,
}: {
  client: TelemetryClient;
  peerHost: PeerHostService;
}) {
  return (
    <TelemetryProvider client={client}>
      <SitrepPeerRelay peerHost={peerHost} />
      <GameStatusProbe testId="host-game" />
    </TelemetryProvider>
  );
}

/**
 * Mounts the stream provider the way `StationScreen` does: the transport exists
 * from the start, the provider only once the host's schema has arrived, which is
 * after the frames the host sends the moment the link opens.
 */
function StationApp({ clientSvc }: { clientSvc: PeerClientService }) {
  const [transport] = useState(() => new PeerTransport(clientSvc));
  const [schemaSeen, setSchemaSeen] = useState(false);
  useEffect(() => clientSvc.onSchema(() => setSchemaSeen(true)), [clientSvc]);
  if (!schemaSeen) return null;
  return (
    <SitrepTelemetryProvider transport={transport}>
      <GameStatusProbe testId="station-game" />
    </SitrepTelemetryProvider>
  );
}

describe("a station joining while the game is not running a scene", () => {
  const services: Array<{ stop?: () => void; disconnect?: () => void }> = [];

  afterEach(() => {
    act(() => {
      for (const svc of services) {
        svc.disconnect?.();
        svc.stop?.();
      }
    });
    services.length = 0;
    localStorage.clear();
    peerRegistry.clear();
  });

  it("shows no game loaded from the join, then each load that follows", async () => {
    const hostTransport = new StubTransport();
    const hostClient = new TelemetryClient(hostTransport);
    const peerHost = new PeerHostService();
    services.push(peerHost);
    render(<HostApp client={hostClient} peerHost={peerHost} />);
    await peerHost.start();

    act(() =>
      hostTransport.emitRaw({
        type: "game-state",
        state: "no-game",
        scene: "MAINMENU",
      }),
    );
    expect(screen.getByTestId("host-game").textContent).toBe(
      "no-game|MAINMENU",
    );

    const clientSvc = new PeerClientService();
    services.push(clientSvc);
    render(<StationApp clientSvc={clientSvc} />);
    act(() => clientSvc.connect(peerHost.shareCode));
    await waitFor(() => expect(clientSvc.getConnStatus()).toBe("connected"));

    await waitFor(
      () =>
        expect(screen.getByTestId("station-game").textContent).toBe(
          "no-game|MAINMENU",
        ),
      { timeout: 8000 },
    );

    act(() =>
      hostTransport.emitRaw({
        type: "game-state",
        state: "loading",
        scene: "TRACKSTATION",
      }),
    );
    await waitFor(
      () =>
        expect(screen.getByTestId("station-game").textContent).toBe(
          "loading|TRACKSTATION",
        ),
      { timeout: 8000 },
    );

    act(() =>
      hostTransport.emitRaw({
        type: "game-state",
        state: "ready",
        scene: "TRACKSTATION",
      }),
    );
    await waitFor(
      () =>
        expect(screen.getByTestId("station-game").textContent).toBe(
          "ready|TRACKSTATION",
        ),
      { timeout: 8000 },
    );
    await act(async () => {});
  });
});
