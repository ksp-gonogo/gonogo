import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import type { Meta, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { Quality, Staleness } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import type {
  PeerHostService,
  SitrepSubscriptionSink,
} from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { SitrepPeerRelay } from "./SitrepPeerRelay";

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
 * Duck-typed fake `PeerHostService`: exposes only the surface
 * `SitrepPeerRelay` touches (`getConnectedPeerIds`/`onPeerConnect`/
 * `onPeerDisconnect`/`broadcast`/`sendToPeer`/`attachSitrepSink`), plus
 * test-only drivers. `claim`/`release` stand in for a station's
 * `sitrep-subscribe`, refcounted per topic exactly as `retainSitrepSub` does,
 * because after the eager carried list went away that is the only route by
 * which any topic reaches the mod.
 */
function makeFakeHost() {
  const connected = new Set<string>();
  const connectListeners = new Set<(id: string) => void>();
  const disconnectListeners = new Set<(id: string) => void>();
  const broadcasts: PeerMessage[] = [];
  const sentToPeer: Array<{ peerId: string; msg: PeerMessage }> = [];
  const claims = new Map<string, { refCount: number; unsub: () => void }>();
  let sink: SitrepSubscriptionSink | null = null;

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
    attachSitrepSink: (next: SitrepSubscriptionSink) => {
      sink = next;
      return () => {
        if (sink === next) sink = null;
      };
    },
    connectPeer(id: string) {
      connected.add(id);
      for (const cb of connectListeners) cb(id);
    },
    disconnectPeer(id: string) {
      connected.delete(id);
      for (const cb of disconnectListeners) cb(id);
    },
    /** A station says it is reading `topic`. */
    claim(topic: string) {
      const existing = claims.get(topic);
      if (existing) {
        existing.refCount += 1;
        return;
      }
      const unsub = sink?.subscribe(topic);
      if (unsub) claims.set(topic, { refCount: 1, unsub });
    },
    /** That station stops reading it. */
    release(topic: string) {
      const entry = claims.get(topic);
      if (!entry) return;
      entry.refCount -= 1;
      if (entry.refCount > 0) return;
      entry.unsub();
      claims.delete(topic);
    },
    cachedFrame(topic: string) {
      return sink?.cachedFrame(topic);
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
  it("subscribes to nothing and broadcasts nothing when no station is connected", async () => {
    const peerHost = makeFakeHost();
    const { transport, view } = renderRelay(peerHost);

    expect(transport.isSubscribed("vessel.orbit")).toBe(false);
    expect(transport.isSubscribed("system.uplinks")).toBe(false);
    expect(peerHost.broadcasts).toEqual([]);

    view.unmount();
  });

  it("holds the bootstrap floor and nothing else for a station with nothing mounted", async () => {
    const peerHost = makeFakeHost();
    const { transport, view } = renderRelay(peerHost);

    act(() => peerHost.connectPeer("station-a"));
    await waitFor(() =>
      // The roster, so the station can find out which bundles to load. It is
      // core's own channel, so pinning it privileges no mod.
      expect(transport.isSubscribed("system.uplinks")).toBe(true),
    );
    // Nothing else, however commonplace: a station reads `vessel.orbit`
    // because a widget on it asked, not because it is a well-known topic.
    expect(transport.isSubscribed("vessel.orbit")).toBe(false);
    expect(transport.isSubscribed("system.bodies")).toBe(false);

    act(() => peerHost.disconnectPeer("station-a"));
    await waitFor(() =>
      expect(transport.isSubscribed("system.uplinks")).toBe(false),
    );

    view.unmount();
  });

  it("subscribes a topic no list names once a station says it is reading it", async () => {
    const peerHost = makeFakeHost();
    const { transport, view } = renderRelay(peerHost);

    act(() => peerHost.connectPeer("station-a"));
    act(() => peerHost.claim("thirdparty.readout"));
    await waitFor(() =>
      expect(transport.isSubscribed("thirdparty.readout")).toBe(true),
    );

    act(() => peerHost.release("thirdparty.readout"));
    await waitFor(() =>
      expect(transport.isSubscribed("thirdparty.readout")).toBe(false),
    );

    view.unmount();
  });

  it("reaches a topic under a dynamic namespace through the same path, with no per-namespace code in between", async () => {
    // The acceptance criterion for removing the eager list. The relay used to
    // mirror one Uplink's device list into a per-device subscription, because
    // that Uplink's ids are only known at runtime and a station's own
    // subscription could not reach the host. Now it can, and a runtime-keyed
    // topic stops being a special case: the station's widget subscribes it like
    // any other, and the relay knows nothing about the namespace.
    const peerHost = makeFakeHost();
    const { transport, view } = renderRelay(peerHost);

    act(() => peerHost.connectPeer("station-a"));
    act(() => {
      peerHost.claim("thirdparty.devices");
      peerHost.claim("thirdparty.device.7");
    });
    await waitFor(() => {
      expect(transport.isSubscribed("thirdparty.devices")).toBe(true);
      expect(transport.isSubscribed("thirdparty.device.7")).toBe(true);
    });
    // And no device the station is not watching: nothing here enumerates them.
    expect(transport.isSubscribed("thirdparty.device.9")).toBe(false);

    act(() => {
      transport.emit("thirdparty.device.7", { id: 7, chunk: "boot ok" });
    });
    await waitFor(() =>
      expect(
        peerHost.broadcasts.some(
          (m) =>
            m.type === "sitrep-frame" &&
            m.message.type === "stream-data" &&
            m.message.topic === "thirdparty.device.7",
        ),
      ).toBe(true),
    );

    view.unmount();
  });

  it("relays a stream-data frame verbatim to connected stations via broadcast", async () => {
    const peerHost = makeFakeHost();
    const { transport, view } = renderRelay(peerHost);

    act(() => peerHost.connectPeer("station-a"));
    act(() => peerHost.claim("vessel.orbit"));
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
    act(() => peerHost.claim("vessel.orbit"));
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

  it("answers a station asking for a topic the host is already holding, from the cache", async () => {
    const peerHost = makeFakeHost();
    const { transport, view } = renderRelay(peerHost);

    // The host reads this on its own account, and the only frame arrives before
    // any station exists. `client.subscribe` for an already-held topic sends no
    // wire subscribe and re-emits no frame, so the cache is the only answer.
    const unsubHost = transport.isSubscribed("vessel.identity");
    expect(unsubHost).toBe(false);
    act(() => {
      transport.emitRaw({
        type: "stream-data",
        topic: "vessel.identity",
        payload: { name: "Kerbal X" },
        meta: makeMeta(),
      });
    });

    act(() => peerHost.connectPeer("station-a"));
    await waitFor(() =>
      expect(peerHost.cachedFrame("vessel.identity")).toMatchObject({
        type: "sitrep-frame",
        message: { topic: "vessel.identity", payload: { name: "Kerbal X" } },
      }),
    );

    view.unmount();
  });

  it("relays event frames live but never backfills them to a later-connecting station", async () => {
    const peerHost = makeFakeHost();
    const { transport, view } = renderRelay(peerHost);

    act(() => peerHost.connectPeer("station-a"));
    act(() => peerHost.claim("crash.lastCrash"));
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
