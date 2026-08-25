import { PerfBudget } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import type { Meta, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { Quality, Staleness } from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { SitrepPeerRelay } from "./SitrepPeerRelay";

/**
 * Two properties of the relay that station-driven subscription is built on top
 * of, pinned separately from the end-to-end proof in
 * `__tests__/sitrep-station-forwarding.test.tsx` because each one constrains
 * what a later change may do.
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
    attachSitrepSink: () => () => {},
    connectPeer(id: string) {
      connected.add(id);
      for (const cb of connectListeners) cb(id);
    },
    broadcasts,
  };
}

function renderRelay(host: ReturnType<typeof makeFakeHost>) {
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
  return { transport, client, view };
}

function relayedTopics(host: ReturnType<typeof makeFakeHost>): string[] {
  return host.broadcasts.flatMap((msg) =>
    msg.type === "sitrep-frame" && msg.message.type === "stream-data"
      ? [msg.message.topic]
      : [],
  );
}

describe("the relay's own subscriptions", () => {
  it("pull nothing from the mod for a topic no screen has asked for", async () => {
    const host = makeFakeHost();
    const { transport, view } = renderRelay(host);

    // The eager set is still here until the station-demand path replaces it.
    expect(transport.isSubscribed("vessel.orbit")).toBe(true);
    // Nothing has asked for this one, on either screen.
    expect(transport.isSubscribed(UPLINK_TOPIC)).toBe(false);

    view.unmount();
    await act(async () => {});
  });
});

describe("the relay tap", () => {
  it("broadcasts frames for topics the relay itself never subscribed to", async () => {
    const host = makeFakeHost();
    const { transport, view } = renderRelay(host);
    const raw: ServerMessage = {
      type: "stream-data",
      topic: UPLINK_TOPIC,
      payload: { value: 3 },
      meta: makeMeta(),
    };
    act(() => {
      transport.emitRaw(raw);
    });

    // Unfiltered by design: whatever arrives at the host reaches every station,
    // whoever asked for it. Per-station delivery filtering would be a bandwidth
    // change, and it can only be made with a test proving nothing is lost,
    // since a delivery set that is wrong loses data silently.
    expect(relayedTopics(host)).toContain(UPLINK_TOPIC);

    view.unmount();
    await act(async () => {});
  });
});

/**
 * Relayed frames scale with the number of connected stations, and after
 * station-driven subscription the relayed topic set is the union of every
 * station's demand, so one station opening a heavy widget spends every other
 * station's PeerJS leg.
 *
 * `SITREP_PEER_RELAY_BUDGET` deliberately cannot see that axis: it records once
 * per frame tapped off the host, not per recipient. The axis IS counted, by
 * `PeerHostService.broadcast`, which is the path a relayed frame takes. Pinned
 * because routing sitrep frames around `broadcast` would leave the axis station
 * demand controls with no instrument on it.
 */
describe("relayed frames are counted per recipient", () => {
  function budgetRate(name: string): number {
    return (
      PerfBudget.getAll()
        .find((b) => b.name === name)
        ?.rate() ?? -1
    );
  }

  it("records once per connected station, not once per frame", () => {
    const host = new PeerHostService();
    const before = budgetRate("PeerHostService.broadcast count/sec");

    // Two stand-in connections, so a single broadcast must count two.
    const conns = [{ send: () => {} }, { send: () => {} }];
    for (const conn of conns) {
      (host as unknown as { connections: Set<unknown> }).connections.add(conn);
    }

    host.broadcast({
      type: "sitrep-frame",
      message: {
        type: "stream-data",
        topic: UPLINK_TOPIC,
        payload: { value: 1 },
        meta: makeMeta(),
      },
    });

    const after = budgetRate("PeerHostService.broadcast count/sec");
    expect(after - before).toBe(conns.length);
    host.stop();
  });
});
