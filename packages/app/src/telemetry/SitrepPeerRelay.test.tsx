import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import type { Meta, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { Quality, Staleness } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { SitrepPeerRelay } from "./SitrepPeerRelay";
import { DEFAULT_SITREP_CARRIED_TOPICS } from "./SitrepTelemetryProvider";

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

/**
 * Duck-typed fake `PeerHostService` — exposes only the surface
 * `SitrepPeerRelay` touches (`getConnectedPeerIds`/`onPeerConnect`/
 * `onPeerDisconnect`/`broadcast`/`sendToPeer`), plus test-only
 * `connectPeer`/`disconnectPeer` drivers.
 */
function makeFakeHost() {
  const connected = new Set<string>();
  const connectListeners = new Set<(id: string) => void>();
  const disconnectListeners = new Set<(id: string) => void>();
  const broadcasts: PeerMessage[] = [];
  const sentToPeer: Array<{ peerId: string; msg: PeerMessage }> = [];

  return {
    getConnectedPeerIds: () => Array.from(connected),
    onPeerConnect: (cb: (id: string) => void) => {
      connectListeners.add(cb);
      return () => connectListeners.delete(cb);
    },
    onPeerDisconnect: (cb: (id: string) => void) => {
      disconnectListeners.add(cb);
      return () => disconnectListeners.delete(cb);
    },
    broadcast: (msg: PeerMessage) => {
      broadcasts.push(msg);
    },
    sendToPeer: (peerId: string, msg: PeerMessage) => {
      sentToPeer.push({ peerId, msg });
    },
    connectPeer(id: string) {
      connected.add(id);
      for (const cb of connectListeners) cb(id);
    },
    disconnectPeer(id: string) {
      connected.delete(id);
      for (const cb of disconnectListeners) cb(id);
    },
    broadcasts,
    sentToPeer,
  };
}

function renderRelay(peerHost: ReturnType<typeof makeFakeHost>) {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const view = render(
    <TelemetryProvider client={client}>
      <SitrepPeerRelay peerHost={peerHost as unknown as PeerHostService} />
    </TelemetryProvider>,
  );
  return { transport, client, view };
}

describe("SitrepPeerRelay", () => {
  afterEach(() => {
    // Match the repo's act()-warning convention: unmount before the test's
    // transport/client fall out of scope.
  });

  it("subscribes to nothing and broadcasts nothing when no station is connected", async () => {
    const peerHost = makeFakeHost();
    const { transport, view } = renderRelay(peerHost);

    expect(transport.isSubscribed(DEFAULT_SITREP_CARRIED_TOPICS[0])).toBe(
      false,
    );
    expect(peerHost.broadcasts).toEqual([]);

    view.unmount();
  });

  it("subscribes to every carried topic once a station connects, and tears down once the last one disconnects", async () => {
    const peerHost = makeFakeHost();
    const { transport, view } = renderRelay(peerHost);

    act(() => peerHost.connectPeer("station-a"));
    await waitFor(() => {
      expect(transport.isSubscribed("vessel.orbit")).toBe(true);
      // A second, unrelated topic — not "comms.delay", which
      // `TelemetryProvider`'s own auto-attached `DelayAuthority` ALSO
      // subscribes to independently, so its ref count never drops to zero
      // just because this relay tears its own subscription down.
      expect(transport.isSubscribed("system.bodies")).toBe(true);
    });

    act(() => peerHost.disconnectPeer("station-a"));
    await waitFor(() => {
      expect(transport.isSubscribed("vessel.orbit")).toBe(false);
      expect(transport.isSubscribed("system.bodies")).toBe(false);
    });

    view.unmount();
  });

  it("relays a stream-data frame verbatim to connected stations via broadcast", async () => {
    const peerHost = makeFakeHost();
    const { transport, view } = renderRelay(peerHost);

    act(() => peerHost.connectPeer("station-a"));
    await waitFor(() =>
      expect(transport.isSubscribed("vessel.orbit")).toBe(true),
    );

    act(() => {
      transport.emit(
        "vessel.orbit",
        { apoapsis: 100_000 },
        { validAt: 5, deliveredAt: 6 },
      );
    });

    await waitFor(() => expect(peerHost.broadcasts).toHaveLength(1));
    expect(peerHost.broadcasts[0]).toMatchObject({
      type: "sitrep-frame",
      message: {
        type: "stream-data",
        topic: "vessel.orbit",
        payload: { apoapsis: 100_000 },
        meta: { validAt: 5, deliveredAt: 6 },
      },
    });

    view.unmount();
  });

  it("backfills the latest cached frame to a newly-connecting station via sendToPeer, never broadcast", async () => {
    const peerHost = makeFakeHost();
    const { transport, view } = renderRelay(peerHost);

    act(() => peerHost.connectPeer("station-a"));
    await waitFor(() =>
      expect(transport.isSubscribed("vessel.orbit")).toBe(true),
    );

    act(() => {
      transport.emit(
        "vessel.orbit",
        { apoapsis: 42 },
        { validAt: 1, deliveredAt: 1 },
      );
    });
    await waitFor(() => expect(peerHost.broadcasts.length).toBeGreaterThan(0));
    const broadcastCountBeforeSecondConnect = peerHost.broadcasts.length;

    act(() => peerHost.connectPeer("station-b"));

    await waitFor(() =>
      expect(peerHost.sentToPeer.some((e) => e.peerId === "station-b")).toBe(
        true,
      ),
    );
    const backfill = peerHost.sentToPeer.find((e) => e.peerId === "station-b");
    expect(backfill?.msg).toMatchObject({
      type: "sitrep-frame",
      message: {
        type: "stream-data",
        topic: "vessel.orbit",
        payload: { apoapsis: 42 },
      },
    });
    // The backfill is a per-connection send, never a second broadcast.
    expect(peerHost.broadcasts.length).toBe(broadcastCountBeforeSecondConnect);

    view.unmount();
  });

  it("subscribes kos.terminal.<coreId> per live CPU so a station-only terminal gets its downlink", async () => {
    const peerHost = makeFakeHost();
    const { transport, view } = renderRelay(peerHost);

    act(() => peerHost.connectPeer("station-a"));
    await waitFor(() =>
      expect(transport.isSubscribed("kos.processors")).toBe(true),
    );

    // The mod publishes the CPU list; the relay mirrors it into per-CPU
    // terminal subscriptions.
    act(() => {
      transport.emit("kos.processors", [
        { coreId: 7, tag: "lander" },
        { coreId: 9, tag: "probe" },
      ]);
    });
    await waitFor(() => {
      expect(transport.isSubscribed("kos.terminal.7")).toBe(true);
      expect(transport.isSubscribed("kos.terminal.9")).toBe(true);
    });

    // A terminal frame for one of them relays verbatim to stations.
    act(() => {
      transport.emit("kos.terminal.7", {
        coreId: 7,
        chunk: "boot ok",
        fullRepaint: true,
      });
    });
    await waitFor(() =>
      expect(
        peerHost.broadcasts.some(
          (m) =>
            m.type === "sitrep-frame" &&
            m.message.type === "stream-data" &&
            m.message.topic === "kos.terminal.7",
        ),
      ).toBe(true),
    );

    // A CPU dropping out of the list drops its terminal subscription.
    act(() => {
      transport.emit("kos.processors", [{ coreId: 7, tag: "lander" }]);
    });
    await waitFor(() =>
      expect(transport.isSubscribed("kos.terminal.9")).toBe(false),
    );
    expect(transport.isSubscribed("kos.terminal.7")).toBe(true);

    view.unmount();
  });

  it("relays event frames live but never backfills them to a later-connecting station", async () => {
    const peerHost = makeFakeHost();
    const { transport, view } = renderRelay(peerHost);

    act(() => peerHost.connectPeer("station-a"));
    await waitFor(() =>
      expect(transport.isSubscribed("crash.lastCrash")).toBe(true),
    );

    const eventFrame: ServerMessage = {
      type: "event",
      topic: "crash.lastCrash",
      name: "crash",
      meta: makeMeta(),
    };
    act(() => transport.emitRaw(eventFrame));

    await waitFor(() =>
      expect(
        peerHost.broadcasts.some(
          (m) => m.type === "sitrep-frame" && m.message.type === "event",
        ),
      ).toBe(true),
    );

    act(() => peerHost.connectPeer("station-b"));
    // Let the connect-driven backfill effect run; there is nothing async to
    // await beyond a microtask/render flush since sendToPeer is synchronous.
    await waitFor(() =>
      expect(peerHost.getConnectedPeerIds()).toContain("station-b"),
    );

    const backfillToB = peerHost.sentToPeer.filter(
      (e) => e.peerId === "station-b",
    );
    expect(
      backfillToB.every(
        (e) => e.msg.type === "sitrep-frame" && e.msg.message.type !== "event",
      ),
    ).toBe(true);

    view.unmount();
  });
});
