/**
 * Two-screen integration proof for station-side Sitrep-stream forwarding
 * (docs/superpowers/plans/2026-07-12-station-stream-forwarding-plan.md).
 *
 * The repo's prior "recorded-fixture top-level test" (the PBDS-bridge
 * two-screen harness referenced in project memory) was deleted in
 * `cb96f069`: the same commit that removed the entire legacy
 * replay stack (`FlightReplayDataSource`, `replay-server`, etc.) it depended
 * on. This is its Sitrep-native successor: same "sequential render, direct
 * in-process wiring, fake peerjs" trick, new pipeline.
 *
 * What's real here: `PeerHostService`, `PeerClientService`, `SitrepPeerRelay`,
 * `PeerTransport`, `TelemetryClient`, `TelemetryProvider`: every class this
 * milestone touches, unmocked. What's faked: PeerJS itself (an in-process
 * bidirectional mock: no real WebRTC/browser networking is available in
 * jsdom) and the host's connection to the mod (a `StubTransport` standing in
 * for a live `WebSocketTransport`, driven with hand-authored frames instead
 * of a recorded fixture: the gitignored `reference-wire-fixture.json` isn't
 * available in CI, so this keeps the test self-contained and deterministic).
 *
 * This does NOT render the full `MainScreen`/`StationScreen` screen
 * components: those are covered by `tsc --noEmit` on the real wiring edits
 * in those files. This test proves the forwarding PLUMBING those screens
 * mount: a host-side `TelemetryClient` -> `SitrepPeerRelay` ->
 * `PeerHostService` -> (fake PeerJS) -> `PeerClientService` -> `PeerTransport`
 * -> a station-side `TelemetryClient`/`TimelineStore`.
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

import { registerUplinkHandle, unregisterUplinkHandle } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  type TimelineStore,
  useCertainty,
  useStream,
  useStreamEvent,
  useTelemetryStore,
} from "@ksp-gonogo/sitrep-client";
import {
  Quality,
  Staleness,
  useHostIceServers,
  useUplinkRelay,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeerClientProvider } from "../peer/PeerClientContext";
import { PeerClientService } from "../peer/PeerClientService";
import { PeerHostService } from "../peer/PeerHostService";
import { PeerTransport } from "../telemetry/PeerTransport";
import { SitrepPeerRelay } from "../telemetry/SitrepPeerRelay";

/**
 * Every `TelemetryProvider` this file mounts builds its own `ViewClock`, whose
 * frame loop reschedules itself forever: two or three mounted screens each turn
 * into a React update every 16ms, for the whole file, and nothing here needs
 * them. `SitrepPeerRelay` and the probes are driven by arrivals, and an arrival
 * mints its own frame through the provider's ingest subscription.
 *
 * So the loops are stopped. This is a CPU claim, not a determinism one, and the
 * difference matters: this file has failed on CI at 1855ms against `waitFor`'s
 * 1s budget, and stopping the loops does not make that assertion deterministic,
 * it only stops three screens burning the runner's time while it waits. A frame
 * pump driven from inside every `waitFor` was written first and then DELETED,
 * because with it replaced by a no-op all fourteen tests still passed: the frame
 * that carries a relayed value is scheduled by the ingest, so driving the clock
 * cannot be what delivers it. A helper whose removal changes nothing is not
 * doing the job its name claims.
 *
 * Captured from inside the tree rather than by handing the providers a store the
 * test built, because how a provider builds its own store (the delay authority
 * it wires into the clock, the derived channels it registers) is part of what
 * this file is proving works across the peer hop.
 */
const liveStores = new Set<TimelineStore>();

/** Hands its provider's own store out, and stops that provider's frame loop. */
function FrameSink(): null {
  const store = useTelemetryStore();
  useEffect(() => {
    liveStores.add(store);
    store.clock.suspendFrames();
  }, [store]);
  return null;
}

// Outside every describe, so it runs after their own teardown.
afterEach(() => {
  liveStores.clear();
});

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
      <FrameSink />
      <SitrepPeerRelay peerHost={peerHost} />
      <Probe testId="host-orbit" topic="vessel.orbit" />
      <Probe testId="host-identity" topic="vessel.identity" />
    </TelemetryProvider>
  );
}

/**
 * The station-side equivalent of `SitrepTelemetryProvider transport={new
 * PeerTransport(client)}`: built directly with `useState` (rather than
 * `SitrepTelemetryProvider`'s own mount-effect) so this test drives the real
 * `PeerTransport`/`TelemetryClient`/`TelemetryProvider` classes without also
 * pulling in `StationScreen`'s full screen tree.
 */
function StationApp({
  clientSvc,
  extraTopic,
}: {
  clientSvc: PeerClientService;
  /** A topic only this station reads, for the station-only-demand tests below. */
  extraTopic?: string;
}) {
  const [telemetryClient] = useState(
    () => new TelemetryClient(new PeerTransport(clientSvc)),
  );
  return (
    <TelemetryProvider client={telemetryClient}>
      <FrameSink />
      <Probe testId="station-orbit" topic="vessel.orbit" />
      <Probe testId="station-identity" topic="vessel.identity" />
      {extraTopic ? <Probe testId="station-extra" topic={extraTopic} /> : null}
    </TelemetryProvider>
  );
}

/**
 * A station widget whose second read depends on its first: a device list names
 * an id, and the id names the downlink topic under a namespace whose keys only
 * exist at runtime. Nothing here knows it is on a station, and nothing outside
 * it knows the namespace.
 */
/** A domain no list, allowlist or first-party Uplink in this repo names. */
const UPLINK_DOMAIN = "thirdparty";

function ChainProbe() {
  const devices =
    useStream<Array<{ id?: number }>>(`${UPLINK_DOMAIN}.devices`) ?? [];
  const id = devices[0]?.id;
  if (id === undefined)
    return <div data-testid="station-terminal">no devices detected</div>;
  return <DownlinkProbe id={id} />;
}

function DownlinkProbe({ id }: { id: number }) {
  // `useStreamEvent`, as a downlink widget does: a stream of chunks rather than
  // a sticky value, and it subscribes the runtime-keyed topic verbatim.
  const [chunk, setChunk] = useState<string>("awaiting");
  useStreamEvent<{ chunk?: string }>(
    `${UPLINK_DOMAIN}.device.${id}`,
    (payload) => {
      setChunk(payload?.chunk ?? "awaiting");
    },
  );
  return <div data-testid="station-terminal">{chunk}</div>;
}

function StationChainApp({ clientSvc }: { clientSvc: PeerClientService }) {
  const [telemetryClient] = useState(
    () => new TelemetryClient(new PeerTransport(clientSvc)),
  );
  return (
    <TelemetryProvider client={telemetryClient}>
      <FrameSink />
      <ChainProbe />
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
 * `TelemetryProvider`: used by the command-RPC test below, which builds
 * its own standalone `PeerTransport`/`TelemetryClient` pair instead. Two
 * `TelemetryProvider`s mounted in the SAME test process (host's + a
 * station's) share the sitrep-client package's one module-level
 * `activeTelemetryClient` slot; the later mount's effect clobbers the
 * earlier one. In production this can't happen (host and station are
 * separate browser contexts), but in-process it means
 * `PeerHostService.handleSitrepCommand`'s `getActiveTelemetryClient()` would
 * resolve to whichever `TelemetryProvider` mounted LAST: the station's, not
 * the host's: turning a dispatched command into an infinite request/reply
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
  extraTopic?: string,
): Promise<PeerClientService> {
  const clientSvc = new PeerClientService();
  render(<StationApp clientSvc={clientSvc} extraTopic={extraTopic} />);
  act(() => clientSvc.connect(peerHost.shareCode));
  await waitFor(() => expect(clientSvc.getConnStatus()).toBe("connected"));
  return clientSvc;
}

describe("station Sitrep-stream forwarding: two-screen proof", () => {
  const stationServices: PeerClientService[] = [];
  const hostServices: PeerHostService[] = [];

  afterEach(() => {
    // `svc.disconnect()` synchronously closes the underlying
    // `FakeDataConnection`, which ripples straight through to the paired
    // remote's "close" handler on `PeerHostService`: still-mounted at this
    // point (RTL's own auto-cleanup afterEach runs AFTER this describe
    // block's, so unmounting hasn't happened yet): firing
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
    // way regardless of the small extra PeerJS-hop latency between them,
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

    /* Explicit windows, because these two assert EVENTUAL CONSISTENCY and not
       latency: a full in-process peer handshake has to complete and a frame has
       to cross it. RTL's default is 1000ms, which is a latency budget nobody
       chose, and CI failed the host one at exactly that boundary while three
       local runs passed. The test's own budget is 30s, so 8s asserts the same
       thing without asserting a speed. If a frame genuinely stops arriving,
       this still fails, eight seconds later. */
    const ARRIVES = { timeout: 8000 };
    await waitFor(
      () =>
        expect(screen.getByTestId("host-orbit").textContent).not.toBe("blank"),
      ARRIVES,
    );
    await waitFor(
      () =>
        expect(screen.getByTestId("station-orbit").textContent).not.toBe(
          "blank",
        ),
      ARRIVES,
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

    // Station 1 connects first: this is what starts SitrepPeerRelay's
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
    // blank forever: nothing re-emits vessel.identity after this point.
    const station2 = await connectStation(peerHost);
    stationServices.push(station2);

    await waitFor(() => {
      const probes = screen.getAllByTestId("station-identity");
      expect(probes).toHaveLength(2);
      expect(probes[1].textContent).not.toBe("blank");
      expect(probes[1].textContent).toBe(probes[0].textContent);
    });
  });

  it("a station's TelemetryClient.dispatch(): the exact call useCommand's carried branch makes, reaches the host over the command RPC", async () => {
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

  it("replies to a sitrep command over the dispatching station's own connection only, a second, idle station never sees it", async () => {
    // Targets the plan's §6 "two-client requestId namespaces" risk directly:
    // a copy-paste of `broadcast` for `PeerHostService.handleSitrepCommand`
    // instead of `conn.send` would leak this response to every connected
    // station, not just the one that asked. Two independently-constructed
    // `TelemetryClient`s each mint their own `requestId` counter starting at
    // "c0", so this also exercises the "two stations' identically-numbered
    // in-flight commands stay in separate namespaces" case the plan calls
    // out: a broadcast bug here wouldn't just leak, it would cross-deliver
    // one station's result under the other's very same in-flight id.
    const { peerHost, hostTransport } = setupHost();
    hostTransport.setCommandHandler((command, args) => ({ command, args }));
    await peerHost.start();
    await waitForHostPeerId(peerHost);

    const stationAService = await connectStationService(peerHost);
    stationServices.push(stationAService);
    const stationBService = await connectStationService(peerHost);
    stationServices.push(stationBService);

    const stationATransport = new PeerTransport(stationAService);
    const stationAClient = new TelemetryClient(stationATransport);
    const stationBTransport = new PeerTransport(stationBService);
    const stationBClient = new TelemetryClient(stationBTransport);

    const stationBResponses: unknown[] = [];
    const stationBErrors: unknown[] = [];
    const offResponse = stationBService.onSitrepCommandResponse(
      (requestId, result) => {
        stationBResponses.push({ requestId, result });
      },
    );
    const offError = stationBService.onSitrepCommandError(
      (requestId, code, message) => {
        stationBErrors.push({ requestId, code, message });
      },
    );

    // Station B is idle, it never dispatches anything. Only station A does.
    const { result } = stationAClient.dispatch("vessel.control.setSas", {
      enabled: true,
    });

    await expect(result).resolves.toEqual({
      command: "vessel.control.setSas",
      args: { enabled: true },
    });

    // Station B's own connection must never have received a reply to a
    // request it never sent.
    expect(stationBResponses).toEqual([]);
    expect(stationBErrors).toEqual([]);

    offResponse();
    offError();
    stationATransport.dispose();
    stationAClient.dispose();
    stationBTransport.dispose();
    stationBClient.dispose();
  });
});

/**
 * A station's mounted widgets are the only thing that knows what a station
 * needs, and they know it at mount time. These prove that knowing it is enough:
 * no allowlist names the topic below, no per-Uplink rule mentions it, and
 * nothing on the main screen reads it.
 *
 * Observation vantage is deliberately absent from this mechanism.
 * `ChannelEngine.HandleSetVantage` keeps `SelectedVantage` on the
 * `ClientSession`, and the host has exactly one session, so two stations cannot
 * observe at two vantages over one relayed stream without a wire change. That
 * is separate work, not an oversight here.
 */
describe("station subscription intent reaches the mod", () => {
  const stationServices: PeerClientService[] = [];
  const hostServices: PeerHostService[] = [];

  afterEach(() => {
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
  } {
    const hostTransport = new StubTransport();
    const hostClient = new TelemetryClient(hostTransport);
    const peerHost = new PeerHostService();
    hostServices.push(peerHost);
    render(<HostApp client={hostClient} peerHost={peerHost} />);
    return { peerHost, hostTransport };
  }

  const UPLINK_TOPIC = "thirdparty.readout";

  it("subscribes upstream for a topic only a station reads", async () => {
    const { peerHost, hostTransport } = setupHost();
    await peerHost.start();
    await waitForHostPeerId(peerHost);

    const clientSvc = await connectStation(peerHost, UPLINK_TOPIC);
    stationServices.push(clientSvc);

    await waitFor(() =>
      expect(hostTransport.isSubscribed(UPLINK_TOPIC)).toBe(true),
    );

    const pastUt = Date.now() / 1000 - 10_000;
    act(() => {
      hostTransport.emit(
        UPLINK_TOPIC,
        { reading: 7 },
        { validAt: pastUt, deliveredAt: pastUt },
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId("station-extra").textContent).toContain("7"),
    );
  });

  it("drops the upstream subscription when the last station wanting it goes", async () => {
    const { peerHost, hostTransport } = setupHost();
    await peerHost.start();
    await waitForHostPeerId(peerHost);

    const clientSvc = await connectStation(peerHost, UPLINK_TOPIC);
    stationServices.push(clientSvc);
    await waitFor(() =>
      expect(hostTransport.isSubscribed(UPLINK_TOPIC)).toBe(true),
    );

    act(() => {
      clientSvc.disconnect();
    });

    await waitFor(() =>
      expect(hostTransport.isSubscribed(UPLINK_TOPIC)).toBe(false),
    );
    // The host's own reads are untouched by a station leaving.
    expect(hostTransport.isSubscribed("vessel.orbit")).toBe(true);
  });

  it("delivers a topic the host was ALREADY holding when the station asked", async () => {
    const { peerHost, hostTransport } = setupHost();
    await peerHost.start();
    await waitForHostPeerId(peerHost);

    // The host reads this one itself, and the only frame for it arrives BEFORE
    // any station exists. Every other test in this file emits AFTER the station
    // has connected, which is why none of them could see this: the relay's
    // cache used to be filled from inside the tap gated on having connections,
    // so it learned nothing until the first station arrived and then only
    // learned what changed. `client.subscribe` for an already-held topic sends
    // no wire subscribe and re-emits no frame, so the mod is never asked
    // either, and the station stays blank forever.
    const pastUt = Date.now() / 1000 - 10_000;
    act(() => {
      hostTransport.emit(
        "vessel.orbit",
        { apoapsis: 250_000, periapsis: 240_000 },
        { validAt: pastUt, deliveredAt: pastUt },
      );
    });

    const clientSvc = await connectStation(peerHost, "vessel.orbit");
    stationServices.push(clientSvc);

    await waitFor(() =>
      expect(screen.getAllByTestId("station-extra")[0]?.textContent).toContain(
        "250000",
      ),
    );
  });

  it("resolves a two-hop chain whose first hop went quiet before the station connected", async () => {
    // The shape a terminal-style widget has, and the one thing that could still
    // have broken when the relay stopped mirroring a device list into a
    // per-device subscription: the station reads the list, picks an id off it,
    // and only then knows which downlink topic to subscribe. Miss the first hop
    // and the widget resolves no id and renders "no devices", an absence stated
    // as a fact.
    //
    // The only frame for the first hop is emitted before the station exists, so
    // this passes on the relay cache rather than on the mod re-emitting.
    const { peerHost, hostTransport } = setupHost();
    await peerHost.start();
    await waitForHostPeerId(peerHost);

    const pastUt = Date.now() / 1000 - 10_000;
    act(() => {
      hostTransport.emitRaw({
        type: "stream-data",
        topic: `${UPLINK_DOMAIN}.devices`,
        payload: [{ id: 7, tag: "lander" }],
        meta: {
          source: "test",
          validAt: pastUt,
          seq: 0,
          deliveredAt: pastUt,
          vantage: "test",
          quality: Quality.OnRails,
          active: false,
          staleness: Staleness.Fresh,
          timelineEpoch: 0,
        },
      });
    });

    const clientSvc = new PeerClientService();
    render(<StationChainApp clientSvc={clientSvc} />);
    act(() => clientSvc.connect(peerHost.shareCode));
    await waitFor(() => expect(clientSvc.getConnStatus()).toBe("connected"));
    stationServices.push(clientSvc);

    // Second hop: the station worked out the id for itself and subscribed the
    // downlink, with nothing namespace-shaped anywhere between it and the mod.
    await waitFor(() =>
      expect(hostTransport.isSubscribed(`${UPLINK_DOMAIN}.device.7`)).toBe(
        true,
      ),
    );

    act(() => {
      hostTransport.emit(
        `${UPLINK_DOMAIN}.device.7`,
        { id: 7, chunk: "boot ok" },
        { validAt: pastUt, deliveredAt: pastUt },
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("station-terminal").textContent).toContain(
        "boot ok",
      ),
    );
  });

  it("backfills a station that subscribes a topic which last changed before it asked", async () => {
    const { peerHost, hostTransport } = setupHost();
    await peerHost.start();
    await waitForHostPeerId(peerHost);

    const first = await connectStation(peerHost, UPLINK_TOPIC);
    stationServices.push(first);
    await waitFor(() =>
      expect(hostTransport.isSubscribed(UPLINK_TOPIC)).toBe(true),
    );

    const pastUt = Date.now() / 1000 - 10_000;
    act(() => {
      hostTransport.emit(
        UPLINK_TOPIC,
        { reading: 11 },
        { validAt: pastUt, deliveredAt: pastUt },
      );
    });
    await waitFor(() =>
      expect(screen.getAllByTestId("station-extra")[0]?.textContent).toContain(
        "11",
      ),
    );

    // A second station asks for the same topic after it went quiet. The host is
    // already subscribed, so no new frame is coming; only a replay reaches it.
    const second = await connectStation(peerHost, UPLINK_TOPIC);
    stationServices.push(second);

    await waitFor(() => {
      const probes = screen.getAllByTestId("station-extra");
      expect(probes).toHaveLength(2);
      expect(probes[1]?.textContent).toContain("11");
    });
  });
});

/**
 * An Uplink's own method calls, made from a station. The widget below reaches
 * the seam the way an outside author would: `useUplinkRelay` off
 * `@ksp-gonogo/sitrep-sdk`, with nothing imported from the app, no per-Uplink
 * entry anywhere, and no knowledge of which screen it is on.
 */
describe("an Uplink's own methods, called from a station", () => {
  const stationServices: PeerClientService[] = [];
  const hostServices: PeerHostService[] = [];

  afterEach(() => {
    act(() => {
      for (const svc of stationServices) svc.disconnect();
      for (const svc of hostServices) svc.stop();
    });
    stationServices.length = 0;
    hostServices.length = 0;
    unregisterUplinkHandle("fixture-uplink");
    localStorage.clear();
    peerRegistry.clear();
  });

  /**
   * The whole of the fixture Uplink's client. Imports the sdk and nothing else,
   * which is the point: an outside author has no other option.
   */
  function FixtureWidget({ onAnswer }: { onAnswer: (value: unknown) => void }) {
    const relay = useUplinkRelay("fixture-uplink");
    useEffect(() => {
      let live = true;
      relay("describe", { detail: "cameras" })
        .then((value) => {
          if (live) onAnswer(value);
        })
        .catch((err: Error) => {
          if (live) onAnswer(`rejected: ${err.message}`);
        });
      return () => {
        live = false;
      };
    }, [relay, onAnswer]);
    return null;
  }

  function StationWithFixture({
    clientSvc,
    onAnswer,
  }: {
    clientSvc: PeerClientService;
    onAnswer: (value: unknown) => void;
  }) {
    return (
      <PeerClientProvider client={clientSvc}>
        <FixtureWidget onAnswer={onAnswer} />
      </PeerClientProvider>
    );
  }

  it("reaches the handle registered on the HOST, with no per-Uplink wiring on either screen", async () => {
    const peerHost = new PeerHostService();
    hostServices.push(peerHost);
    await peerHost.start();
    await waitForHostPeerId(peerHost);

    const calls: Array<{ method: string; args: unknown }> = [];
    registerUplinkHandle("fixture-uplink", {
      relay: (method: string, args: unknown) => {
        calls.push({ method, args });
        return Promise.resolve({ cameras: [1, 2] });
      },
    });

    const clientSvc = new PeerClientService();
    stationServices.push(clientSvc);
    const answers: unknown[] = [];
    render(
      <StationWithFixture
        clientSvc={clientSvc}
        onAnswer={(value) => answers.push(value)}
      />,
    );
    act(() => clientSvc.connect(peerHost.shareCode));
    await waitFor(() => expect(clientSvc.getConnStatus()).toBe("connected"));

    // The widget mounts before the link is up, so its first attempt is
    // rejected and the status edge re-fires the effect. That retry is the
    // answer, and getting it without the Uplink writing a retry is the point.
    await waitFor(() => expect(answers.at(-1)).toEqual({ cameras: [1, 2] }));
    expect(calls.at(-1)).toEqual({
      method: "describe",
      args: { detail: "cameras" },
    });
  });

  it("rejects rather than hanging when the Uplink has no handle on the host", async () => {
    const peerHost = new PeerHostService();
    hostServices.push(peerHost);
    await peerHost.start();
    await waitForHostPeerId(peerHost);

    const clientSvc = new PeerClientService();
    stationServices.push(clientSvc);
    const answers: unknown[] = [];
    render(
      <StationWithFixture
        clientSvc={clientSvc}
        onAnswer={(value) => answers.push(value)}
      />,
    );
    act(() => clientSvc.connect(peerHost.shareCode));
    await waitFor(() => expect(clientSvc.getConnStatus()).toBe("connected"));

    // Once connected the host answers, and its answer is the named refusal
    // rather than silence: an Uplink whose handle never registered can say so.
    await waitFor(() =>
      expect(String(answers.at(-1))).toContain("no relay handle registered"),
    );
  });

  it("calls the handle directly on a screen with no peer client, same code in the widget", async () => {
    const calls: string[] = [];
    registerUplinkHandle("fixture-uplink", {
      relay: (method: string) => {
        calls.push(method);
        return Promise.resolve("local");
      },
    });

    const answers: unknown[] = [];
    render(<FixtureWidget onAnswer={(value) => answers.push(value)} />);

    await waitFor(() => expect(answers).toEqual(["local"]));
    expect(calls).toEqual(["describe"]);
  });
});

/**
 * TURN credentials for an Uplink opening a media connection from a station. A
 * station cannot fetch its own: the relay that issues them is reachable from
 * the main screen, and the loopback address the main screen uses resolves on a
 * station to the station itself. So the host broadcasts them, and this is the
 * read an Uplink makes.
 */
describe("host-issued ICE servers, read from a station", () => {
  const stationServices: PeerClientService[] = [];
  const hostServices: PeerHostService[] = [];

  afterEach(() => {
    act(() => {
      for (const svc of stationServices) svc.disconnect();
      for (const svc of hostServices) svc.stop();
    });
    stationServices.length = 0;
    hostServices.length = 0;
    localStorage.clear();
    peerRegistry.clear();
  });

  const TURN: RTCIceServer[] = [
    { urls: "turn:relay.example:3478", username: "u", credential: "c" },
  ];

  /** Imports the sdk and nothing else, as an outside author would. */
  function IceProbe({ onServers }: { onServers: (s: RTCIceServer[]) => void }) {
    const ice = useHostIceServers();
    useEffect(() => {
      onServers(ice.current());
      return ice.onChange(onServers);
    }, [ice, onServers]);
    return null;
  }

  it("delivers a rotation to a mounted Uplink without the widget re-rendering", async () => {
    const peerHost = new PeerHostService();
    hostServices.push(peerHost);
    await peerHost.start();
    await waitForHostPeerId(peerHost);

    const clientSvc = new PeerClientService();
    stationServices.push(clientSvc);
    const seen: RTCIceServer[][] = [];
    render(
      <PeerClientProvider client={clientSvc}>
        <IceProbe onServers={(s) => seen.push(s)} />
      </PeerClientProvider>,
    );
    act(() => clientSvc.connect(peerHost.shareCode));
    await waitFor(() => expect(clientSvc.getConnStatus()).toBe("connected"));

    // Nothing issued yet reads as none, not as a fabricated server.
    expect(seen.at(-1)).toEqual([]);

    act(() => {
      peerHost.broadcast({
        type: "relay-peer-id",
        peerId: "relay-1",
        iceServers: TURN,
      });
    });

    await waitFor(() => expect(seen.at(-1)).toEqual(TURN));
  });

  it("reads empty on a screen with no peer client, so the main screen fetches its own", async () => {
    const seen: RTCIceServer[][] = [];
    render(<IceProbe onServers={(s) => seen.push(s)} />);
    await waitFor(() => expect(seen).toEqual([[]]));
  });
});
