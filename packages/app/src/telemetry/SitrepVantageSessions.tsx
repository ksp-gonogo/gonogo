import { PerfBudget } from "@ksp-gonogo/core";
import {
  TelemetryClient,
  type Transport,
  WebSocketTransport,
} from "@ksp-gonogo/sitrep-client";
import type { ServerMessage, StreamData } from "@ksp-gonogo/sitrep-sdk";
import { useEffect } from "react";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { getSitrepHostConfig } from "./sitrepRuntime";

/**
 * Frames relayed out of a SECOND session, counted apart from the host's own
 * (`Telemetry relay frames/sec`). Separate because the two answer different
 * questions: that one asks whether the host's stream is healthy, this one asks
 * what an extra remote vantage is costing, and a budget that mixed them could
 * not say which had run away.
 *
 * Sized level with the host's own fan-out: a second vantage is a second copy of
 * the same traffic, not a fraction of it.
 */
const SITREP_VANTAGE_RELAY_BUDGET = new PerfBudget({
  name: "Extra-vantage relay frames/sec",
  threshold: 3000,
  windowMs: 1000,
  unit: "frames",
});

function isStreamFrame(message: ServerMessage): message is StreamData<unknown> {
  return message.type === "stream-data";
}

/**
 * The slice of the host this component drives: open a session for a vantage,
 * serve that vantage's subscriptions, and send its frames to the peers reading
 * from it. Declared off `PeerHostService`'s own members so it cannot drift,
 * and narrow for the same reason `StationInfoBroadcaster` takes a
 * `StationInfoAnnouncer`: a caller standing one up for a test should not have
 * to build a broker connection.
 */
export interface VantageSessionHost {
  onRequestedVantagesChanged: PeerHostService["onRequestedVantagesChanged"];
  attachSitrepSinkFor: PeerHostService["attachSitrepSinkFor"];
  broadcastToVantage: PeerHostService["broadcastToVantage"];
}

export interface VantageSession {
  /** Hold an upstream subscription for `topic` on this session. */
  subscribe(topic: string, cb: () => void): () => void;
  /** Every raw frame this session receives. */
  onRawMessage(cb: (message: ServerMessage) => void): () => void;
  /** Close the session and its socket. */
  dispose(): void;
}

/**
 * Build a live session observing from `vantage`. Replaceable so a test can
 * drive the open/close reconciliation without a socket, the same seam
 * `SitrepTelemetryProvider` offers for its own transport.
 */
export type OpenVantageSession = (vantage: string) => VantageSession;

const openLiveSession: OpenVantageSession = (vantage) => {
  const { host, port } = getSitrepHostConfig();
  const transport = new WebSocketTransport({
    host,
    port,
    onStreamFrame: () => SITREP_VANTAGE_RELAY_BUDGET.record(),
  });
  const client = new TelemetryClient(transport as Transport);
  client.setVantage(vantage);
  return client;
};

/**
 * One live mod session per vantage a connected peer has asked to observe from,
 * and the relay of each session's frames to the peers at that vantage.
 *
 * **Why a second session at all.** The mod keeps the chosen vantage per CLIENT
 * SESSION and applies each subscriber's delay from it, so two humans observing
 * from two places need two sessions. There is no way to serve both from one:
 * re-pointing the host's own session would move every station with it, and a
 * frame does not carry the delay it travelled under, so the second view cannot
 * be re-derived at this end from the first.
 *
 * **A bare `TelemetryClient`, deliberately never a second `TelemetryProvider`.**
 * The spine registers `activeTelemetryClient`, `activeViewClock` and
 * `activeTimelineStore` as module-scope last-writer-wins singletons, so a
 * second provider would hijack `getActiveTelemetryClient()` out from under
 * `PeerHostService.handleSitrepCommand`, `ScetAlarmBridge` and
 * `uplinks/host.ts`, all of which mean the HOST's client when they ask for it.
 * Nothing here needs a store or a clock: the session is a pipe, and the peer at
 * the far end does its own deriving.
 *
 * Mounted beside `SitrepPeerRelay`, which serves the host's own session the
 * same way. This one serves every other vantage and holds nothing when no peer
 * has asked for one, which is every session that has no remote pilot in it.
 */
export function SitrepVantageSessions({
  peerHost,
  openSession = openLiveSession,
}: {
  peerHost: VantageSessionHost;
  openSession?: OpenVantageSession;
}) {
  useEffect(() => {
    /*
     * Keyed by vantage so a vantage that is still wanted across a change keeps
     * the session it already has: tearing every session down and rebuilding on
     * each change would drop a pilot's socket whenever an unrelated peer
     * arrived.
     */
    const sessions = new Map<string, () => void>();

    const open = (vantage: string) => {
      const client = openSession(vantage);

      /*
       * The last frame seen per topic, so a peer subscribing to something this
       * session already holds is answered at once rather than waiting on the
       * mod's next emission, which on a low-rate topic can be never. The host's
       * own relay keeps one for the same reason.
       */
      const cache = new Map<string, StreamData<unknown>>();
      const detachRaw = client.onRawMessage((message) => {
        if (!isStreamFrame(message)) return;
        cache.set(message.topic, message);
        peerHost.broadcastToVantage(vantage, {
          type: "sitrep-frame",
          message,
        } satisfies PeerMessage);
      });

      const detachSink = peerHost.attachSitrepSinkFor(vantage, {
        subscribe: (topic) => client.subscribe(topic, () => {}),
        cachedFrame: (topic) => {
          const frame = cache.get(topic);
          return frame
            ? ({ type: "sitrep-frame", message: frame } satisfies PeerMessage)
            : undefined;
        },
      });

      sessions.set(vantage, () => {
        detachSink();
        detachRaw();
        client.dispose();
      });
    };

    const reconcile = (wanted: readonly string[]) => {
      const keep = new Set(wanted);
      for (const [vantage, close] of [...sessions]) {
        if (keep.has(vantage)) continue;
        close();
        sessions.delete(vantage);
      }
      for (const vantage of wanted) {
        if (!sessions.has(vantage)) open(vantage);
      }
    };

    const off = peerHost.onRequestedVantagesChanged(reconcile);
    return () => {
      off();
      for (const close of sessions.values()) close();
      sessions.clear();
    };
  }, [peerHost, openSession]);

  return null;
}
