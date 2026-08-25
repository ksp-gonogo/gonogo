import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import type { Meta, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { Quality, Staleness } from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import type { PeerClientService } from "../peer/PeerClientService";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { PeerTransport } from "./PeerTransport";
import { SitrepPeerRelay } from "./SitrepPeerRelay";

/**
 * What an Uplink's own wire topic actually does on the station path today.
 * Nothing here asserts a desired end state, these are the current facts the
 * station-parity seam has to change, pinned so a change to any of them is
 * visible rather than inferred from reading the relay.
 */

const UPLINK_TOPIC = "thirdparty.readout";

function makeMeta(): Meta {
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
  };
}

function makeFakeHost() {
  const connected = new Set<string>();
  const connectListeners = new Set<(id: string) => void>();
  const disconnectListeners = new Set<(id: string) => void>();
  const broadcasts: PeerMessage[] = [];

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
    sendToPeer: () => {},
    connectPeer(id: string) {
      connected.add(id);
      for (const cb of connectListeners) cb(id);
    },
    broadcasts,
  };
}

function relayedTopics(host: ReturnType<typeof makeFakeHost>): string[] {
  return host.broadcasts.flatMap((msg) =>
    msg.type === "sitrep-frame" && msg.message.type === "stream-data"
      ? [msg.message.topic]
      : [],
  );
}

describe("station parity: an Uplink's own wire topic", () => {
  it("is not subscribed by the host relay, so the mod never publishes it for a station", async () => {
    const host = makeFakeHost();
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const view = render(
      <TelemetryProvider client={client}>
        <SitrepPeerRelay peerHost={host as unknown as PeerHostService} />
      </TelemetryProvider>,
    );
    act(() => {
      host.connectPeer("station-1");
    });

    expect(transport.isSubscribed("vessel.orbit")).toBe(true);
    expect(transport.isSubscribed(UPLINK_TOPIC)).toBe(false);

    view.unmount();
    await act(async () => {});
  });

  it("reaches a station only while the MAIN screen happens to hold a subscription to it", async () => {
    const host = makeFakeHost();
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const view = render(
      <TelemetryProvider client={client}>
        <SitrepPeerRelay peerHost={host as unknown as PeerHostService} />
      </TelemetryProvider>,
    );
    act(() => {
      host.connectPeer("station-1");
    });

    // No main-screen widget reading it: the mod would never send a frame,
    // and a frame that did arrive unsolicited is dropped before the relay.
    act(() => {
      transport.emit(UPLINK_TOPIC, { value: 1 }, makeMeta());
    });
    expect(relayedTopics(host)).not.toContain(UPLINK_TOPIC);

    // A main-screen widget mounts and reads it. The station's own dashboard
    // did not change, but the topic now reaches the station.
    const unsub = client.subscribe(UPLINK_TOPIC, () => {});
    act(() => {
      transport.emit(UPLINK_TOPIC, { value: 2 }, makeMeta());
    });
    expect(relayedTopics(host)).toContain(UPLINK_TOPIC);

    unsub();
    view.unmount();
    await act(async () => {});
  });

  it("cannot be requested by the station: PeerTransport drops subscribe on the floor", () => {
    const sent: string[] = [];
    const fakePeerClient = {
      getConnStatus: () => "connected" as const,
      onSitrepFrame: () => () => {},
      onSitrepCommandResponse: () => () => {},
      onSitrepCommandError: () => () => {},
      onConnectionStatus: () => () => {},
      sendSitrepCommand: (_id: string, command: string) => {
        sent.push(command);
      },
    };
    const peerTransport = new PeerTransport(
      fakePeerClient as unknown as PeerClientService,
    );

    peerTransport.send({ type: "subscribe", topic: UPLINK_TOPIC });

    expect(sent).toEqual([]);
    peerTransport.dispose();
  });
});

/**
 * The relay tap is unfiltered: every frame the host's transport delivers is
 * broadcast, whatever asked for it. That is what makes the previous test's
 * "only while the main screen reads it" behaviour possible, and what a
 * per-station subscription model has to replace rather than sit beside.
 */
describe("station parity: the relay tap", () => {
  it("broadcasts frames for topics the relay itself never subscribed to", async () => {
    const host = makeFakeHost();
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const view = render(
      <TelemetryProvider client={client}>
        <SitrepPeerRelay peerHost={host as unknown as PeerHostService} />
      </TelemetryProvider>,
    );
    act(() => {
      host.connectPeer("station-1");
    });
    const raw: ServerMessage = {
      type: "stream-data",
      topic: UPLINK_TOPIC,
      payload: { value: 3 },
      meta: makeMeta(),
    };
    act(() => {
      transport.emitRaw(raw);
    });

    expect(relayedTopics(host)).toContain(UPLINK_TOPIC);

    view.unmount();
    await act(async () => {});
  });
});
