import { PerfBudget } from "@ksp-gonogo/core";
import { useTelemetryClientOptional } from "@ksp-gonogo/sitrep-client";
import type { ServerMessage, StreamData } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useRef, useState } from "react";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { DEFAULT_SITREP_CARRIED_TOPICS } from "./SitrepTelemetryProvider";

/**
 * Fan-out budget for the host relay: separate from `SITREP_STREAM_BUDGET`
 * (WS ingest, `SitrepTelemetryProvider.tsx`) and `PEER_BROADCAST_*` (legacy
 * `data`-type peer traffic, `PeerHostService.ts`), per this repo's "any new
 * fan-out path needs its own budget" rule. Sized off `SITREP_STREAM_BUDGET`'s
 * own 750/sec steady-state figure with headroom for 1-3 connected stations
 * (each relayed frame is broadcast to every connected station, but this
 * budget counts RELAY events: one record per frame tapped off the host's
 * own client: not per-station sends, so it doesn't need to scale with
 * station count itself).
 */
const SITREP_PEER_RELAY_BUDGET = new PerfBudget({
  name: "Telemetry relay frames/sec",
  threshold: 3000,
  windowMs: 1000,
  unit: "frames",
});

/**
 * Station-driven upstream subscribe/release operations. Separate from the frame
 * budget above because it measures a different thing and fails for different
 * reasons: frames are steady-state volume, these are churn, and a widget
 * remounting in a loop or a dashboard thrashing its layout shows up here long
 * before it shows up there. Sized for several stations swapping whole dashboards
 * at once, which is the realistic burst.
 */
const SITREP_PEER_SUB_BUDGET = new PerfBudget({
  name: "Station stream subscribes/sec",
  threshold: 200,
  windowMs: 1000,
  unit: "subscribes",
});

function isCarriedFrame(
  message: ServerMessage,
): message is StreamData<unknown> | Extract<ServerMessage, { type: "event" }> {
  return message.type === "stream-data" || message.type === "event";
}

/**
 * Host-side stream forwarding: taps the host's own live `TelemetryClient`
 * (via `useTelemetryClientOptional()`: the SAME client instance
 * `SitrepTelemetryProvider` mounted, never a second connection to the mod)
 * and relays every `stream-data`/`event` frame it receives VERBATIM to every
 * connected station, wrapped in a `sitrep-frame` envelope. Architecturally a
 * live sibling of `StreamRecorder` (`@ksp-gonogo/sitrep-client`): instead of
 * pushing frames into an array for later replay, it pushes them onto the
 * PeerJS wire.
 *
 * Renders nothing. Mount as a child of `<SitrepTelemetryProvider>` (needs to
 * be inside the provider's subtree to read the live client); see
 * `MainScreen.tsx`.
 *
 * Upstream subscription is DEMAND-DRIVEN: `attachSitrepSink` hands
 * `PeerHostService` the ability to hold a `client.subscribe(topic, noop)`
 * keep-alive, and the host holds one per topic any connected station says it is
 * reading. The no-op callbacks carry nothing; delivery happens off the
 * `onRawMessage` tap below.
 *
 * Alongside that, this still eagerly subscribes `DEFAULT_SITREP_CARRIED_TOPICS`
 * while any station is connected. That eager set is what stations depended on
 * before their own subscriptions could reach the host, and removing it is a
 * separate, subtractive change: keeping it here means demand-driven
 * subscription can only ADD topics a station reaches, never take one away.
 *
 * Backfill: keeps its own `Map<topic, StreamData>` of the last-seen frame
 * per topic, filled from mount rather than from the first station's arrival,
 * and never cleared, so it stays useful across a connect/disconnect gap. It is
 * replayed to a NEWLY connecting peer alone (`sendToPeer`, never `broadcast`)
 * and to a station that subscribes a topic the host was already holding, so
 * neither sits blank on a low-rate topic that has not changed since it asked. `event` frames are
 * one-shot by nature and deliberately NOT backfilled, same posture as
 * `StreamRecorder`'s "don't replay events out of causal context".
 */
export function SitrepPeerRelay({ peerHost }: { peerHost: PeerHostService }) {
  const client = useTelemetryClientOptional();
  const [hasConnections, setHasConnections] = useState(
    () => peerHost.getConnectedPeerIds().length > 0,
  );
  // Ref, not state: this cache is mutated on every relayed frame (up to
  // hundreds/sec) and must never itself trigger a re-render, only
  // `hasConnections` does. Persists across connect/disconnect churn
  // (deliberately never cleared) so a station reconnecting after a gap
  // still gets the last-known value immediately.
  const cacheRef = useRef(new Map<string, StreamData<unknown>>());

  useEffect(() => {
    const update = () =>
      setHasConnections(peerHost.getConnectedPeerIds().length > 0);
    update();
    const offConnect = peerHost.onPeerConnect(update);
    const offDisconnect = peerHost.onPeerDisconnect(update);
    return () => {
      offConnect();
      offDisconnect();
    };
  }, [peerHost]);

  // Per-connection backfill: independent of `hasConnections`'s own
  // subscribe/teardown gating below: for the SECOND (and later) station to
  // connect while the relay is already live, the cache is already populated
  // from ongoing broadcasts and must be replayed to that connection alone.
  // For the FIRST connecting station there's nothing cached yet (nothing
  // was subscribed before any station connected), which is correct: there
  // is genuinely no prior value to backfill.
  useEffect(() => {
    return peerHost.onPeerConnect((peerId) => {
      for (const frame of cacheRef.current.values()) {
        peerHost.sendToPeer(peerId, {
          type: "sitrep-frame",
          message: frame,
        } satisfies PeerMessage);
      }
    });
  }, [peerHost]);

  // Cache every frame the host's client receives, whether or not a station is
  // connected. The broadcast tap below cannot do this: it lives inside the
  // `hasConnections` gate, so the cache learned nothing until the first station
  // arrived and after that only learned what CHANGED. A station asking for a
  // topic the host was already holding then found an empty cache, and
  // `client.subscribe` sends no wire subscribe and re-emits no frame for a
  // topic already subscribed (it replays the sticky value to the CALLER only),
  // so the mod was never asked either and the station stayed blank forever.
  // Caching from mount is what makes `cachedFrame` able to answer.
  useEffect(() => {
    if (!client) return;
    return client.onRawMessage((message) => {
      if (message.type === "stream-data") {
        cacheRef.current.set(message.topic, message);
      }
    });
  }, [client]);

  // Demand-driven upstream subscription, independent of `hasConnections`: the
  // host refcounts what stations ask for and this is only the means of acting
  // on it, so it attaches for as long as there is a client to subscribe
  // through. Reads the same frame cache the per-connection backfill above uses,
  // so a station subscribing a quiet topic gets its current value rather than
  // waiting for a change that may never come.
  useEffect(() => {
    if (!client) return;
    return peerHost.attachSitrepSink({
      subscribe: (topic) => {
        SITREP_PEER_SUB_BUDGET.record();
        return client.subscribe(topic, () => {});
      },
      cachedFrame: (topic) => {
        const frame = cacheRef.current.get(topic);
        return frame
          ? ({ type: "sitrep-frame", message: frame } satisfies PeerMessage)
          : undefined;
      },
    });
  }, [client, peerHost]);

  useEffect(() => {
    if (!client || !hasConnections) return;
    const unsubTopics = DEFAULT_SITREP_CARRIED_TOPICS.map((topic) =>
      client.subscribe(topic, () => {}),
    );

    // Dynamic kos.terminal.<coreId> downlinks aren't in the static carried
    // list (the coreIds aren't known up front). A station opening a kOS
    // terminal subscribes over PeerTransport, but that subscription never
    // reaches the host's mod client: so unless the host is itself subscribed,
    // no terminal frames arrive to relay. Mirror kos.processors here and keep
    // the host subscribed to every current CPU's terminal topic while any
    // station is connected, so a station-only terminal gets its downlink. The
    // mod's poll is subscription- and change-gated, so an idle CPU costs one
    // repaint then goes quiet; only an active screen streams. (v2 bandwidth
    // follow-up: a ref-counted sitrep-subscribe from the station, same as the
    // static-list eager-subscribe note above.)
    const terminalSubs = new Map<number, () => void>();
    const syncTerminalSubs = (payload: unknown) => {
      const list = Array.isArray(payload)
        ? (payload as Array<{ coreId?: number }>)
        : [];
      const present = new Set<number>();
      for (const p of list) {
        if (typeof p?.coreId === "number") present.add(p.coreId);
      }
      for (const coreId of present) {
        if (!terminalSubs.has(coreId)) {
          terminalSubs.set(
            coreId,
            client.subscribe(`kos.terminal.${coreId}`, () => {}),
          );
        }
      }
      for (const [coreId, unsub] of terminalSubs) {
        if (!present.has(coreId)) {
          unsub();
          terminalSubs.delete(coreId);
        }
      }
    };
    // subscribe() replays the sticky last processor list synchronously, so the
    // current CPUs are subscribed immediately; later updates re-sync.
    const unsubProcessors = client.subscribe(
      "kos.processors",
      syncTerminalSubs,
    );

    const detachRaw = client.onRawMessage((message) => {
      if (!isCarriedFrame(message)) return;
      SITREP_PEER_RELAY_BUDGET.record();
      peerHost.broadcast({
        type: "sitrep-frame",
        message,
      } satisfies PeerMessage);
    });
    return () => {
      detachRaw();
      unsubProcessors();
      for (const unsub of terminalSubs.values()) unsub();
      for (const unsub of unsubTopics) unsub();
    };
  }, [client, hasConnections, peerHost]);

  return null;
}
