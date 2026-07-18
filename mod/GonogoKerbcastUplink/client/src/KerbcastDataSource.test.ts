import {
  GAME_HOST_KEY,
  getUplinkHandle,
  resetSettingsForTests,
  setSetting,
} from "@ksp-gonogo/core";
import { Layer } from "@ksp-gonogo/kerbcast";
import { MockSidecar } from "@ksp-gonogo/kerbcast/testing";
import { act } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KerbcastDataSource, kerbcastSource } from "./KerbcastDataSource";
import {
  createMockKerbcastSession,
  kerbcastFetchImpl,
} from "./test/MockKerbcastSession";

// Every KerbcastDataSource subscribes to the shared gameHost in its
// constructor, so a test that never disconnect()s leaks that subscription into
// the module-scoped listener registry across tests. Build them through this
// factory and tear every instance down in afterEach so no test has to remember
// (disconnect() is idempotent, so tests that already call it stay fine).
const createdSources: KerbcastDataSource[] = [];
function makeTracked(
  ...args: ConstructorParameters<typeof KerbcastDataSource>
): KerbcastDataSource {
  const ds = new KerbcastDataSource(...args);
  createdSources.push(ds);
  return ds;
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(kerbcastFetchImpl());
});

afterEach(() => {
  for (const ds of createdSources.splice(0)) ds.disconnect();
  resetSettingsForTests();
  localStorage.clear();
});

describe("KerbcastDataSource", () => {
  it("maps client state-change events onto DataSource status", async () => {
    const session = createMockKerbcastSession();
    const ds = makeTracked({ port: 1 }, session.transport);
    expect(ds.status).toBe("disconnected");

    const seen: string[] = [];
    ds.onStatusChange((s) => seen.push(s));

    await ds.connect();
    session.setState("connected");

    expect(seen).toContain("reconnecting"); // "connecting" → "reconnecting"
    expect(seen).toContain("connected");
    expect(ds.status).toBe("connected");
  });

  it("routes set-fov execute() onto the control channel", async () => {
    const session = createMockKerbcastSession();
    const ds = makeTracked({ port: 1 }, session.transport);
    await ds.connect();
    session.openChannel();
    session.sentMessages.length = 0; // drop the hello

    await ds.execute("kerbcast.set-fov[42,35.5]");

    expect(session.sentMessages[0]).toBe(
      JSON.stringify({
        type: "set-fov",
        content: { flightId: 42, fov: 35.5 },
      }),
    );
  });

  it("routes set-layers execute() with NEAR / SCALED layer args", async () => {
    const session = createMockKerbcastSession();
    const ds = makeTracked({ port: 1 }, session.transport);
    await ds.connect();
    session.openChannel();
    session.sentMessages.length = 0;

    await ds.execute("kerbcast.set-layers[7,NEAR,SCALED]");

    expect(session.sentMessages[0]).toBe(
      JSON.stringify({
        type: "set-layers",
        content: { flightId: 7, layers: [Layer.Near, Layer.Scaled] },
      }),
    );
  });

  it("subscribe('kerbcast.cameras') replays the current snapshot", async () => {
    const session = createMockKerbcastSession();
    const ds = makeTracked({ port: 1 }, session.transport);

    const received: unknown[] = [];
    ds.subscribe("kerbcast.cameras", (v) => received.push(v));

    await new Promise<void>((r) => queueMicrotask(r));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([]);
  });

  it("dials the sidecar at the shared core gameHost", async () => {
    setSetting(GAME_HOST_KEY, "192.168.5.5");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sdp: "answer", cameras: [] }), {
        status: 200,
      }),
    );
    const ds = makeTracked();
    await ds.relayOffer({ sdp: "offer", cameras: [] });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://192.168.5.5:8088/offer",
      expect.anything(),
    );
    fetchSpy.mockRestore();
    ds.disconnect();
  });

  it("configSchema exposes only port (host is core-owned)", () => {
    const ds = makeTracked();
    const keys = ds.configSchema().map((f) => f.key);
    expect(keys).toEqual(["port"]);
    ds.disconnect();
  });
});

describe("KerbcastDataSource — relay TURN / ice-config (TURN-on-demand)", () => {
  const STUN_DEFAULT: RTCIceServer = {
    urls: "stun:stun.l.google.com:19302",
  };
  const TURN: RTCIceServer = {
    urls: ["turn:relay.example:3478?transport=udp"],
    username: "u",
    credential: "c",
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts STUN-only on the main screen — no /ice-config fetch up front", async () => {
    // The main→sidecar leg is LAN, so the first attempt must NOT fetch the
    // relay's TURN creds; gathering a relay candidate it never uses is exactly
    // the per-feed coturn port burn TURN-on-demand removes.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      kerbcastFetchImpl({ iceServers: [TURN] }),
    );

    const session = createMockKerbcastSession();
    const ds = makeTracked({ port: 1 }, session.transport);
    await ds.connect();

    expect(session.iceServers).toEqual([STUN_DEFAULT]);
    const fetchSpy = vi.mocked(globalThis.fetch);
    expect(
      fetchSpy.mock.calls.some(([url]) => String(url).includes("/ice-config")),
    ).toBe(false);

    ds.disconnect();
  });

  it("escalates to the relay's TURN servers after a failed connection", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      kerbcastFetchImpl({ iceServers: [TURN] }),
    );

    const session = createMockKerbcastSession();
    const ds = makeTracked({ port: 1 }, session.transport);
    await ds.connect();
    expect(session.iceServers).toEqual([STUN_DEFAULT]); // STUN-only first

    // ICE couldn't traverse → fail. The reconnect (backoff ~2s) now pulls TURN.
    session.setState("failed");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_001);
    });

    expect(session.iceServers).toEqual([TURN]);

    ds.disconnect();
  });

  it("does not swap the client instance when escalating to TURN", async () => {
    // The camera hooks capture getClient() once and bind to its events, so the
    // escalation must mutate the existing client in place — a swap would leave
    // them bound to a dead instance (black camera on exactly the TURN path).
    vi.spyOn(globalThis, "fetch").mockImplementation(
      kerbcastFetchImpl({ iceServers: [TURN] }),
    );

    const session = createMockKerbcastSession();
    const ds = makeTracked({ port: 1 }, session.transport);
    const clientBefore = ds.getClient();
    await ds.connect();

    session.setState("failed");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_001);
    });

    expect(ds.getClient()).toBe(clientBefore);
    expect(session.iceServers).toEqual([TURN]);

    ds.disconnect();
  });

  it("stays on the SDK STUN default when the relay has no TURN, even after a failure", async () => {
    // Empty iceServers stands in for a 503 / unreachable relay — escalation must
    // not break the reconnect, leaving the client on its STUN default.
    vi.spyOn(globalThis, "fetch").mockImplementation(kerbcastFetchImpl());

    const session = createMockKerbcastSession();
    const ds = makeTracked({ port: 1 }, session.transport);
    await ds.connect();
    expect(session.iceServers).toEqual([STUN_DEFAULT]);

    session.setState("failed");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_001);
    });

    expect(session.iceServers).toEqual([STUN_DEFAULT]);

    ds.disconnect();
  });
});

describe("KerbcastDataSource — keepalive + reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("responds to ping with pong", async () => {
    const session = createMockKerbcastSession();
    const ds = makeTracked({ port: 1 }, session.transport);

    await ds.connect();
    session.openChannel();
    session.sentMessages.length = 0; // drop hello

    session.sendServerMessage({ type: "ping" });

    expect(session.sentMessages).toContain(JSON.stringify({ type: "pong" }));
  });

  it("ping resets the watchdog so no reconnect fires within 15s of last ping", async () => {
    const session = createMockKerbcastSession();
    const ds = makeTracked({ port: 1 }, session.transport);

    await ds.connect();
    session.setState("connected");

    const fetchSpy = vi.mocked(globalThis.fetch);
    const callsBefore = fetchSpy.mock.calls.length;

    // Advance 14s — no ping yet, watchdog hasn't fired
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });

    // Fire a ping (resets the watchdog)
    session.sendServerMessage({ type: "ping" });

    // Advance another 14s (28s total from connect, but only 14s since the ping)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });

    // No reconnect attempt should have happened
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);

    ds.disconnect();
  });

  it("watchdog fires after 15s and triggers reconnect", async () => {
    const session = createMockKerbcastSession();
    const ds = makeTracked({ port: 1 }, session.transport);

    await ds.connect();
    session.setState("connected");

    const fetchSpy = vi.mocked(globalThis.fetch);
    const callsBefore = fetchSpy.mock.calls.length;

    // No ping — advance past the 15s watchdog
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_001);
    });

    // Reconnect attempt should have fired (a new /offer fetch)
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);

    ds.disconnect();
  });

  it("explicit disconnect() prevents reconnect after watchdog fires", async () => {
    const session = createMockKerbcastSession();
    const ds = makeTracked({ port: 1 }, session.transport);

    await ds.connect();
    session.setState("connected");

    ds.disconnect();

    const fetchSpy = vi.mocked(globalThis.fetch);
    const callsAfterDisconnect = fetchSpy.mock.calls.length;

    // Advance well past any watchdog or reconnect threshold
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(fetchSpy.mock.calls.length).toBe(callsAfterDisconnect);
  });

  it("WebRTC 'failed' triggers exponential backoff", async () => {
    const session = createMockKerbcastSession();
    const ds = makeTracked({ port: 1 }, session.transport);

    await ds.connect();
    session.setState("connected");

    const fetchSpy = vi.mocked(globalThis.fetch);
    const callsBefore = fetchSpy.mock.calls.length;

    // Fire a failed state — should schedule a reconnect at 2s
    session.setState("failed");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_001);
    });

    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);

    ds.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Dynamic slot subscription — exercised against the SDK's canonical protocol
// fake (MockSidecar) rather than the local transport fake, so these tests cover
// the real subscribe → slot-map round-trip the sidecar speaks.
// ---------------------------------------------------------------------------

describe("KerbcastDataSource — dynamic slot subscription", () => {
  function mockFetch(): void {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
      Promise.resolve(
        String(input).includes("/ice-config")
          ? new Response(JSON.stringify({ iceServers: [] }), { status: 200 })
          : MockSidecar.makeOfferResponse([]),
      ),
    );
  }

  async function connectedSidecar(
    flightIds: number[] = [42, 43],
  ): Promise<{ ds: KerbcastDataSource; sidecar: MockSidecar }> {
    const sidecar = new MockSidecar();
    flightIds.forEach((flightId) => {
      sidecar.addCamera({ flightId });
    });
    mockFetch();
    const ds = makeTracked({ port: 1 }, sidecar.createTransport());
    await ds.connect();
    sidecar.open();
    sidecar.setConnectionState("connected");
    return { ds, sidecar };
  }

  function subscribeCount(sidecar: MockSidecar, flightId: number): number {
    return sidecar.commands.filter(
      (c) => c.type === "subscribe" && c.content.flightId === flightId,
    ).length;
  }

  it("binds a slot when a camera is subscribed while connected", async () => {
    const { ds, sidecar } = await connectedSidecar();

    ds.subscribeCamera(42);

    expect(sidecar.lastCommand("subscribe", 42)).toBeTruthy();
    expect(sidecar.slotMidFor(42)).toBeDefined();

    ds.disconnect();
  });

  it("refcounts subscribers — one slot shared, freed only on the last release", async () => {
    const { ds, sidecar } = await connectedSidecar();

    ds.subscribeCamera(42);
    ds.subscribeCamera(42); // a second widget shows the same camera

    expect(subscribeCount(sidecar, 42)).toBe(1); // one slot, not two

    ds.unsubscribeCamera(42); // first widget gone — still shown elsewhere
    expect(sidecar.lastCommand("unsubscribe", 42)).toBeUndefined();
    expect(sidecar.slotMidFor(42)).toBeDefined();

    ds.unsubscribeCamera(42); // last widget gone — slot frees
    expect(sidecar.lastCommand("unsubscribe", 42)).toBeTruthy();
    expect(sidecar.slotMidFor(42)).toBeUndefined();

    ds.disconnect();
  });

  it("switching cameras frees the old slot and binds the new one", async () => {
    const { ds, sidecar } = await connectedSidecar();

    ds.subscribeCamera(42);
    expect(sidecar.slotMidFor(42)).toBeDefined();

    // The flightId change useKerbcastStream drives: release old, bind new.
    ds.unsubscribeCamera(42);
    ds.subscribeCamera(43);

    expect(sidecar.slotMidFor(42)).toBeUndefined();
    expect(sidecar.slotMidFor(43)).toBeDefined();

    ds.disconnect();
  });

  it("re-binds on-screen cameras via the initial offer set (cold start / reconnect)", async () => {
    const sidecar = new MockSidecar();
    sidecar.addCamera({ flightId: 42 });
    mockFetch();
    const fetchSpy = vi.mocked(globalThis.fetch);
    const ds = makeTracked({ port: 1 }, sidecar.createTransport());

    // A widget mounts before the sidecar is reachable.
    ds.subscribeCamera(42);
    // Nothing can be sent over a closed channel — no live subscribe yet.
    expect(sidecar.commands.some((c) => c.type === "subscribe")).toBe(false);

    // The fetch spy accumulates calls across tests in this file; drop the
    // history so the /offer we inspect below is unambiguously this connect's.
    fetchSpy.mockClear();
    await ds.connect();

    // The desired camera rides along as the offer's initial bound set, so the
    // sidecar pushes its SlotMap on Hello without a client-side round-trip.
    const offerCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes("/offer"),
    );
    const body = JSON.parse(String(offerCall?.[1]?.body ?? "{}")) as {
      slots?: number;
      cameras?: number[];
    };
    expect(body.slots).toBe(6);
    expect(body.cameras).toEqual([42]);

    ds.disconnect();
  });
});

// ---------------------------------------------------------------------------
// relayOffer — the main screen's half of the station broker. Forwards a
// station's offer to the local sidecar's /offer and returns the answer.
// ---------------------------------------------------------------------------

describe("KerbcastDataSource — relayOffer (station broker)", () => {
  it("POSTs the offer to the sidecar /offer and returns the answer", async () => {
    setSetting(GAME_HOST_KEY, "sidehost");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sdp: "answer-sdp", cameras: [42, 43] }), {
        status: 200,
      }),
    );
    fetchSpy.mockClear();

    const ds = makeTracked({ port: 9090 });
    const answer = await ds.relayOffer({
      sdp: "offer-sdp",
      cameras: [42, 43],
      slots: 6,
    });

    expect(answer).toEqual({ sdp: "answer-sdp", cameras: [42, 43] });
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://sidehost:9090/offer");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      sdp: "offer-sdp",
      cameras: [42, 43],
      slots: 6,
    });
  });

  it("throws when the sidecar returns a non-OK status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    );

    const ds = makeTracked({ port: 1 });
    await expect(ds.relayOffer({ sdp: "o", cameras: [] })).rejects.toThrow(
      /503/,
    );
  });
});

// ---------------------------------------------------------------------------
// registerUplinkHandle("kerbcast", ...) — the host-side relay handle a
// station's peer-relayed negotiate() call dispatches through (see
// PeerHostService.handleUplinkRelay). Delegates to the module singleton's
// relayOffer(), unchanged.
// ---------------------------------------------------------------------------

describe("KerbcastDataSource module — registerUplinkHandle('kerbcast', ...) registration", () => {
  it("delegates the 'negotiate' relay method to the kerbcastSource singleton's relayOffer", async () => {
    setSetting(GAME_HOST_KEY, "sidehost");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sdp: "answer-sdp", cameras: [1] }), {
        status: 200,
      }),
    );
    fetchSpy.mockClear();

    const handle = getUplinkHandle<{
      relay: (method: string, args: unknown) => Promise<unknown>;
    }>("kerbcast");
    expect(handle).toBeDefined();

    const answer = await handle?.relay("negotiate", {
      sdp: "offer-sdp",
      cameras: [1],
    });
    expect(answer).toEqual({ sdp: "answer-sdp", cameras: [1] });
    // Prove it went through the real relayOffer(), not a stub.
    expect(fetchSpy).toHaveBeenCalledWith(
      `http://sidehost:${kerbcastSource.getConfig().port}/offer`,
      expect.anything(),
    );
  });

  it("rejects an unknown relay method", async () => {
    const handle = getUplinkHandle<{
      relay: (method: string, args: unknown) => Promise<unknown>;
    }>("kerbcast");
    await expect(handle?.relay("bogus", {})).rejects.toThrow(
      /unknown method "bogus"/,
    );
  });

  it("registers the full kerbcastSource instance, not a narrower relay-only object", () => {
    const handle = getUplinkHandle<KerbcastDataSource>("kerbcast");
    expect(handle).toBe(kerbcastSource);
    expect(typeof handle?.getClient).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Brokered (station) mode — the station relays the handshake through the host
// and takes TURN creds from the broadcast, never touching localhost.
// ---------------------------------------------------------------------------

describe("KerbcastDataSource — brokered (station) mode", () => {
  const TURN: RTCIceServer = {
    urls: ["turn:relay.example:3478"],
    username: "u",
    credential: "c",
  };

  function cfgIce(ds: KerbcastDataSource): RTCIceServer[] | undefined {
    return (
      ds.getClient() as unknown as { cfg: { iceServers?: RTCIceServer[] } }
    ).cfg.iceServers;
  }

  it("routes the handshake through the broker and skips the localhost fetch", async () => {
    const sidecar = new MockSidecar();
    sidecar.addCamera({ flightId: 42 });
    // A station has no relay on localhost — any fetch here is a bug.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("no localhost relay on a station"));
    fetchSpy.mockClear();

    const negotiate = vi.fn((offer: { sdp: string; cameras: number[] }) =>
      sidecar.negotiate(offer),
    );
    const ds = makeTracked({ port: 1 }, sidecar.createTransport());
    ds.attachBroker({
      negotiate,
      iceServers: () => [TURN],
      onIceServersChange: () => () => {},
    });

    await ds.connect();

    // Neither /ice-config nor /offer was fetched — the broker handled signaling.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(negotiate).toHaveBeenCalledTimes(1);
    // The client was built with the broker-supplied TURN creds.
    expect(cfgIce(ds)).toEqual([TURN]);

    ds.disconnect();
  });

  it("applies rotated relay creds from the broadcast in place (no client swap)", async () => {
    const sidecar = new MockSidecar();
    let fireIceChange: ((servers: RTCIceServer[]) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      MockSidecar.makeOfferResponse([]),
    );

    const ds = makeTracked({ port: 1 }, sidecar.createTransport());
    ds.attachBroker({
      negotiate: (offer) => sidecar.negotiate(offer),
      iceServers: () => [],
      onIceServersChange: (cb) => {
        fireIceChange = cb;
        return () => {};
      },
    });

    const clientBefore = ds.getClient();
    // Host broadcasts TURN creds after the station is already brokered.
    fireIceChange?.([TURN]);

    // Mutated in place so the camera hooks stay bound to the same client.
    expect(ds.getClient()).toBe(clientBefore);
    expect(cfgIce(ds)).toEqual([TURN]);
  });

  it("stays idle until a camera is wanted, then lazily connects via the broker", async () => {
    const sidecar = new MockSidecar();
    sidecar.addCamera({ flightId: 42 });
    // A station has no localhost relay — any fetch would be the wrong path.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no localhost"));
    const negotiate = vi.fn((offer: { sdp: string; cameras: number[] }) =>
      sidecar.negotiate(offer),
    );

    const ds = makeTracked({ port: 1 }, sidecar.createTransport());
    ds.attachBroker({
      negotiate,
      iceServers: () => [],
      onIceServersChange: () => () => {},
    });

    // Brokered but no camera wanted yet → no connection, no negotiate.
    expect(ds.status).toBe("disconnected");
    expect(negotiate).not.toHaveBeenCalled();

    // First camera widget asks for a stream → lazy connect through the broker.
    ds.subscribeCamera(42);
    await vi.waitFor(() => {
      expect(negotiate).toHaveBeenCalledTimes(1);
    });

    ds.disconnect();
  });
});
