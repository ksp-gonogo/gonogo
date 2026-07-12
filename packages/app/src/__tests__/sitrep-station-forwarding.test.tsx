/**
 * Two-screen integration proof for station-side Sitrep-stream forwarding
 * (docs/superpowers/plans/2026-07-12-station-stream-forwarding-plan.md).
 *
 * The repo's prior "recorded-fixture top-level test" (the PBDS-bridge
 * two-screen harness referenced in project memory) was deleted in
 * `cb96f069` — the same commit that removed the entire legacy Telemachus
 * replay stack (`FlightReplayDataSource`, `replay-server`, etc.) it depended
 * on. This is its Sitrep-native successor: same "sequential render, direct
 * in-process wiring, fake peerjs" trick, new pipeline.
 *
 * What's real here: `PeerHostService`, `PeerClientService`, `SitrepPeerRelay`,
 * `PeerTransport`, `TelemetryClient`, `TelemetryProvider` — every class this
 * milestone touches, unmocked. What's faked: PeerJS itself (an in-process
 * bidirectional mock — no real WebRTC/browser networking is available in
 * jsdom) and the host's connection to the mod (a `StubTransport` standing in
 * for a live `WebSocketTransport`, driven with hand-authored frames instead
 * of a recorded fixture — the gitignored `reference-wire-fixture.json` isn't
 * available in CI, so this keeps the test self-contained and deterministic).
 *
 * This does NOT render the full `MainScreen`/`StationScreen` screen
 * components — those are covered by `tsc --noEmit` on the real wiring edits
 * in those files. This test proves the forwarding PLUMBING those screens
 * mount: a host-side `TelemetryClient` -> `SitrepPeerRelay` ->
 * `PeerHostService` -> (fake PeerJS) -> `PeerClientService` -> `PeerTransport`
 * -> a station-side `TelemetryClient`/`TimelineStore`.
 */

// ---------------------------------------------------------------------------
// Fake PeerJS — bidirectional in-process mock (adapted from the retired
// recorded-fixture harness at `cb96f069^`). Two `FakePeer`s in the same
// process find each other by id through `peerRegistry`; `peer.connect(id)`
// pairs `FakeDataConnection`s so `send()` on one side lands in the other's
// `"data"` listener — close enough to real PeerJS to exercise the real
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
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  useCertainty,
  useStream,
  useTelemetryStore,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeerClientService } from "../peer/PeerClientService";
import { PeerHostService } from "../peer/PeerHostService";
import { PeerTransport } from "../telemetry/PeerTransport";
import { SitrepPeerRelay } from "../telemetry/SitrepPeerRelay";

/** Renders a topic's sampled value + certainty as one comparable string. Reads through `TimelineStore.sample`, the exact surface `useDataValue`'s shim and every real widget read through. */
function Probe({ testId, topic }: { testId: string; topic: string }) {
  const value = useStream<Record<string, unknown>>(topic);
  const store = useTelemetryStore();
  const certainty = useCertainty(store);
  return (
    <div data-testid={testId}>
      {value === undefined ? "blank" : `${JSON.stringify(value)}|${certainty}`}
    </div>
  );
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
      <Probe testId="host-orbit" topic="vessel.orbit" />
      <Probe testId="host-identity" topic="vessel.identity" />
    </TelemetryProvider>
  );
}

/**
 * The station-side equivalent of `SitrepTelemetryProvider transport={new
 * PeerTransport(client)}` — built directly with `useState` (rather than
 * `SitrepTelemetryProvider`'s own mount-effect) so this test drives the real
 * `PeerTransport`/`TelemetryClient`/`TelemetryProvider` classes without also
 * pulling in `StationScreen`'s full screen tree.
 */
function StationApp({ clientSvc }: { clientSvc: PeerClientService }) {
  const [telemetryClient] = useState(
    () => new TelemetryClient(new PeerTransport(clientSvc)),
  );
  return (
    <TelemetryProvider client={telemetryClient}>
      <Probe testId="station-orbit" topic="vessel.orbit" />
      <Probe testId="station-identity" topic="vessel.identity" />
    </TelemetryProvider>
  );
}

async function waitForHostPeerId(peerHost: PeerHostService): Promise<void> {
  if (peerHost.peerId) return;
  await new Promise<void>((resolve) => {
    const unsub = peerHost.onPeerIdChange((id) => {
      if (id) {
        unsub();
        resolve();
      }
    });
  });
}

/**
 * Connects a bare `PeerClientService` WITHOUT mounting `StationApp`'s
 * `TelemetryProvider` — used by the command-RPC test below, which builds
 * its own standalone `PeerTransport`/`TelemetryClient` pair instead. Two
 * `TelemetryProvider`s mounted in the SAME test process (host's + a
 * station's) share the sitrep-client package's one module-level
 * `activeTelemetryClient` slot; the later mount's effect clobbers the
 * earlier one. In production this can't happen (host and station are
 * separate browser contexts), but in-process it means
 * `PeerHostService.handleSitrepCommand`'s `getActiveTelemetryClient()` would
 * resolve to whichever `TelemetryProvider` mounted LAST — the station's, not
 * the host's — turning a dispatched command into an infinite request/reply
 * loop (the "host" dispatches back through the station's own transport,
 * which sends it to the host again, forever). Keeping the command-RPC
 * test's station client un-rendered avoids ever mounting a second
 * `TelemetryProvider`.
 */
async function connectStationService(
  peerHost: PeerHostService,
): Promise<PeerClientService> {
  const clientSvc = new PeerClientService();
  act(() => clientSvc.connect(peerHost.shareCode));
  await waitFor(() => expect(clientSvc.getConnStatus()).toBe("connected"));
  return clientSvc;
}

async function connectStation(
  peerHost: PeerHostService,
): Promise<PeerClientService> {
  const clientSvc = new PeerClientService();
  render(<StationApp clientSvc={clientSvc} />);
  act(() => clientSvc.connect(peerHost.shareCode));
  await waitFor(() => expect(clientSvc.getConnStatus()).toBe("connected"));
  return clientSvc;
}

describe("station Sitrep-stream forwarding — two-screen proof", () => {
  const stationServices: PeerClientService[] = [];
  const hostServices: PeerHostService[] = [];

  afterEach(() => {
    // `svc.disconnect()` synchronously closes the underlying
    // `FakeDataConnection`, which ripples straight through to the paired
    // remote's "close" handler on `PeerHostService` — still-mounted at this
    // point (RTL's own auto-cleanup afterEach runs AFTER this describe
    // block's, so unmounting hasn't happened yet) — firing
    // `SitrepPeerRelay`'s `onPeerDisconnect`-driven `setHasConnections`
    // outside any `act()` boundary. Wrap the teardown itself in `act()`
    // rather than reordering cleanup, since the whole point is tearing
    // down while still mounted (matches every other connected component
    // in this suite).
    act(() => {
      for (const svc of stationServices) svc.disconnect();
      for (const svc of hostServices) svc.stop();
    });
    stationServices.length = 0;
    hostServices.length = 0;
    localStorage.clear();
    peerRegistry.clear();
  });

  function setupHost(): {
    peerHost: PeerHostService;
    hostTransport: StubTransport;
    hostClient: TelemetryClient;
  } {
    const hostTransport = new StubTransport();
    const hostClient = new TelemetryClient(hostTransport);
    const peerHost = new PeerHostService();
    hostServices.push(peerHost);
    render(<HostApp client={hostClient} peerHost={peerHost} />);
    return { peerHost, hostTransport, hostClient };
  }

  it("relays a live frame to a station widget with the SAME value and certainty as the main screen", async () => {
    const { peerHost, hostTransport } = setupHost();
    await peerHost.start();
    await waitForHostPeerId(peerHost);

    const clientSvc = await connectStation(peerHost);
    stationServices.push(clientSvc);

    // A "confirmed" sample: validAt/deliveredAt deep in the past relative
    // to real wall time, so both screens' ViewClocks classify it the same
    // way regardless of the small extra PeerJS-hop latency between them —
    // this is the delay-correctness claim from the plan's §5: a station
    // never sees a sample the host's own clock wouldn't already call
    // confirmed, because it never receives it any earlier than the host did.
    const pastUt = Date.now() / 1000 - 10_000;
    act(() => {
      hostTransport.emit(
        "vessel.orbit",
        { apoapsis: 100_000, periapsis: 80_000 },
        { validAt: pastUt, deliveredAt: pastUt },
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId("host-orbit").textContent).not.toBe("blank"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("station-orbit").textContent).not.toBe("blank"),
    );

    const hostText = screen.getByTestId("host-orbit").textContent;
    const stationText = screen.getByTestId("station-orbit").textContent;
    expect(stationText).toBe(hostText);
    expect(stationText).toContain("confirmed");
    expect(stationText).toContain("100000");
  });

  it("backfills a late-connecting station immediately for a topic that stopped changing before it joined", async () => {
    const { peerHost, hostTransport } = setupHost();
    await peerHost.start();
    await waitForHostPeerId(peerHost);

    // Station 1 connects first — this is what starts SitrepPeerRelay's
    // eager subscription (v1: nothing is subscribed until at least one
    // station is connected).
    const station1 = await connectStation(peerHost);
    stationServices.push(station1);

    const pastUt = Date.now() / 1000 - 10_000;
    act(() => {
      hostTransport.emit(
        "vessel.identity",
        { name: "Kerbal X" },
        { validAt: pastUt, deliveredAt: pastUt },
      );
    });
    await waitFor(() =>
      expect(screen.getAllByTestId("station-identity")[0].textContent).not.toBe(
        "blank",
      ),
    );

    // Station 2 connects mid-flight, AFTER vessel.identity last changed.
    // Without SitrepPeerRelay's per-connection backfill this would stay
    // blank forever — nothing re-emits vessel.identity after this point.
    const station2 = await connectStation(peerHost);
    stationServices.push(station2);

    await waitFor(() => {
      const probes = screen.getAllByTestId("station-identity");
      expect(probes).toHaveLength(2);
      expect(probes[1].textContent).not.toBe("blank");
      expect(probes[1].textContent).toBe(probes[0].textContent);
    });
  });

  it("a station's TelemetryClient.dispatch() — the exact call useCommand's carried branch makes — reaches the host over the command RPC", async () => {
    const { peerHost, hostTransport } = setupHost();
    hostTransport.setCommandHandler((command, args) => ({ command, args }));
    await peerHost.start();
    await waitForHostPeerId(peerHost);

    const clientSvc = await connectStationService(peerHost);
    stationServices.push(clientSvc);

    const stationTransport = new PeerTransport(clientSvc);
    const stationClient = new TelemetryClient(stationTransport);

    const { result } = stationClient.dispatch("vessel.control.setSas", {
      enabled: true,
    });

    await expect(result).resolves.toEqual({
      command: "vessel.control.setSas",
      args: { enabled: true },
    });

    stationTransport.dispose();
    stationClient.dispose();
  });
});
