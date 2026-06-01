import { Layer } from "@jonpepler/kerbcam";
import { MockSidecar } from "@jonpepler/kerbcam/testing";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KerbcamDataSource } from "./KerbcamDataSource";
import {
  createMockKerbcamSession,
  kerbcamFetchImpl,
} from "./test/MockKerbcamSession";

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(kerbcamFetchImpl());
});

describe("KerbcamDataSource", () => {
  it("maps client state-change events onto DataSource status", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);
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
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);
    await ds.connect();
    session.openChannel();
    session.sentMessages.length = 0; // drop the hello

    await ds.execute("kerbcam.set-fov[42,35.5]");

    expect(session.sentMessages[0]).toBe(
      JSON.stringify({
        type: "set-fov",
        content: { flightId: 42, fov: 35.5 },
      }),
    );
  });

  it("routes set-layers execute() with NEAR / SCALED layer args", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);
    await ds.connect();
    session.openChannel();
    session.sentMessages.length = 0;

    await ds.execute("kerbcam.set-layers[7,NEAR,SCALED]");

    expect(session.sentMessages[0]).toBe(
      JSON.stringify({
        type: "set-layers",
        content: { flightId: 7, layers: [Layer.Near, Layer.Scaled] },
      }),
    );
  });

  it("subscribe('kerbcam.cameras') replays the current snapshot", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);

    const received: unknown[] = [];
    ds.subscribe("kerbcam.cameras", (v) => received.push(v));

    await new Promise<void>((r) => queueMicrotask(r));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([]);
  });
});

describe("KerbcamDataSource — relay TURN / ice-config", () => {
  it("threads the relay's TURN servers into the peer connection", async () => {
    const turn: RTCIceServer = {
      urls: ["turn:relay.example:3478?transport=udp"],
      username: "u",
      credential: "c",
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(
      kerbcamFetchImpl({ iceServers: [turn] }),
    );

    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);
    await ds.connect();

    expect(session.iceServers).toEqual([turn]);
  });

  it("does not swap the client instance when applying TURN creds", async () => {
    // The camera hooks capture getClient() once and bind to its events, so the
    // TURN path must mutate the existing client in place — a swap would leave
    // them bound to a dead instance (black camera on exactly the TURN path).
    vi.spyOn(globalThis, "fetch").mockImplementation(
      kerbcamFetchImpl({
        iceServers: [{ urls: ["turn:relay.example:3478"] }],
      }),
    );

    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);
    const clientBefore = ds.getClient();
    await ds.connect();

    expect(ds.getClient()).toBe(clientBefore);
    expect(session.iceServers).toEqual([{ urls: ["turn:relay.example:3478"] }]);
  });

  it("falls back to the SDK STUN default when the relay has no TURN", async () => {
    // Empty iceServers stands in for a 503 / unreachable relay — the data
    // source must not break connect, leaving the client on its STUN default.
    vi.spyOn(globalThis, "fetch").mockImplementation(kerbcamFetchImpl());

    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);
    await ds.connect();

    expect(session.iceServers).toEqual([
      { urls: "stun:stun.l.google.com:19302" },
    ]);
  });
});

describe("KerbcamDataSource — keepalive + reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("responds to ping with pong", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);

    await ds.connect();
    session.openChannel();
    session.sentMessages.length = 0; // drop hello

    session.sendServerMessage({ type: "ping" });

    expect(session.sentMessages).toContain(JSON.stringify({ type: "pong" }));
  });

  it("ping resets the watchdog so no reconnect fires within 15s of last ping", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);

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
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);

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
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);

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
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);

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

describe("KerbcamDataSource — dynamic slot subscription", () => {
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
  ): Promise<{ ds: KerbcamDataSource; sidecar: MockSidecar }> {
    const sidecar = new MockSidecar();
    flightIds.forEach((flightId) => {
      sidecar.addCamera({ flightId });
    });
    mockFetch();
    const ds = new KerbcamDataSource(
      { host: "h", port: 1 },
      sidecar.createTransport(),
    );
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

    // The flightId change useKerbcamStream drives: release old, bind new.
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
    const ds = new KerbcamDataSource(
      { host: "h", port: 1 },
      sidecar.createTransport(),
    );

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

describe("KerbcamDataSource — relayOffer (station broker)", () => {
  it("POSTs the offer to the sidecar /offer and returns the answer", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sdp: "answer-sdp", cameras: [42, 43] }), {
        status: 200,
      }),
    );
    fetchSpy.mockClear();

    const ds = new KerbcamDataSource({ host: "sidehost", port: 9090 });
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

    const ds = new KerbcamDataSource({ host: "h", port: 1 });
    await expect(ds.relayOffer({ sdp: "o", cameras: [] })).rejects.toThrow(
      /503/,
    );
  });
});

// ---------------------------------------------------------------------------
// Brokered (station) mode — the station relays the handshake through the host
// and takes TURN creds from the broadcast, never touching localhost.
// ---------------------------------------------------------------------------

describe("KerbcamDataSource — brokered (station) mode", () => {
  const TURN: RTCIceServer = {
    urls: ["turn:relay.example:3478"],
    username: "u",
    credential: "c",
  };

  function cfgIce(ds: KerbcamDataSource): RTCIceServer[] | undefined {
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
    const ds = new KerbcamDataSource(
      { host: "h", port: 1 },
      sidecar.createTransport(),
    );
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

    const ds = new KerbcamDataSource(
      { host: "h", port: 1 },
      sidecar.createTransport(),
    );
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

    const ds = new KerbcamDataSource(
      { host: "h", port: 1 },
      sidecar.createTransport(),
    );
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
