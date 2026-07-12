import { PerfBudget } from "@ksp-gonogo/core";
import { useTelemetryClientOptional } from "@ksp-gonogo/sitrep-client";
import type { ServerMessage, StreamData } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useRef, useState } from "react";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { DEFAULT_SITREP_CARRIED_TOPICS } from "./SitrepTelemetryProvider";

/**
 * Fan-out budget for the host relay — separate from `SITREP_STREAM_BUDGET`
 * (WS ingest, `SitrepTelemetryProvider.tsx`) and `PEER_BROADCAST_*` (legacy
 * `data`-type peer traffic, `PeerHostService.ts`), per this repo's "any new
 * fan-out path needs its own budget" rule. Sized off `SITREP_STREAM_BUDGET`'s
 * own 750/sec steady-state figure with headroom for 1-3 connected stations
 * (each relayed frame is broadcast to every connected station, but this
 * budget counts RELAY events — one record per frame tapped off the host's
 * own client — not per-station sends, so it doesn't need to scale with
 * station count itself).
 */
const SITREP_PEER_RELAY_BUDGET = new PerfBudget({
  name: "SitrepPeerRelay frames relayed/sec",
  threshold: 3000,
  windowMs: 1000,
  unit: "frames",
});

function isCarriedFrame(
  message: ServerMessage,
): message is StreamData<unknown> | Extract<ServerMessage, { type: "event" }> {
  return message.type === "stream-data" || message.type === "event";
}

/**
 * Host-side stream forwarding: taps the host's own live `TelemetryClient`
 * (via `useTelemetryClientOptional()` — the SAME client instance
 * `SitrepTelemetryProvider` mounted, never a second connection to the mod)
 * and relays every `stream-data`/`event` frame it receives VERBATIM to every
 * connected station, wrapped in a `sitrep-frame` envelope. Architecturally a
 * live sibling of `StreamRecorder` (`@ksp-gonogo/sitrep-client`) — instead of
 * pushing frames into an array for later replay, it pushes them onto the
 * PeerJS wire.
 *
 * Renders nothing. Mount as a child of `<SitrepTelemetryProvider>` (needs to
 * be inside the provider's subtree to read the live client) — see
 * `MainScreen.tsx`.
 *
 * v1 is eager, broadcast-all: the moment at least one station is connected,
 * this subscribes to every topic in `DEFAULT_SITREP_CARRIED_TOPICS` (a
 * ref-count keep-alive via `client.subscribe(topic, noop)` — the actual
 * delivery to stations happens off the `onRawMessage` tap, not these
 * no-op callbacks) and tears every subscription down once the last station
 * disconnects. See
 * docs/superpowers/plans/2026-07-12-station-stream-forwarding-plan.md §2 for
 * why eager-subscribe-all is the deliberate v1 simplification (a
 * `sitrep-subscribe`/`unsubscribe` ref-counted pair is the v2 bandwidth
 * follow-up, not a correctness requirement).
 *
 * Backfill: keeps its own `Map<topic, StreamData>` of the last-seen frame
 * per topic (never cleared, so it stays useful across a connect/disconnect
 * gap) and replays it to a NEWLY connecting peer alone (`sendToPeer`, never
 * `broadcast`) so a station connecting mid-flight doesn't sit blank on a
 * low-rate topic that hasn't changed since it joined. `event` frames are
 * one-shot by nature and deliberately NOT backfilled — same posture as
 * `StreamRecorder`'s "don't replay events out of causal context".
 */
export function SitrepPeerRelay({ peerHost }: { peerHost: PeerHostService }) {
  const client = useTelemetryClientOptional();
  const [hasConnections, setHasConnections] = useState(
    () => peerHost.getConnectedPeerIds().length > 0,
  );
  // Ref, not state: this cache is mutated on every relayed frame (up to
  // hundreds/sec) and must never itself trigger a re-render — only
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
  // subscribe/teardown gating below — for the SECOND (and later) station to
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

  useEffect(() => {
    if (!client || !hasConnections) return;
    const unsubTopics = DEFAULT_SITREP_CARRIED_TOPICS.map((topic) =>
      client.subscribe(topic, () => {}),
    );

    // Dynamic kos.terminal.<coreId> downlinks aren't in the static carried
    // list (the coreIds aren't known up front). A station opening a kOS
    // terminal subscribes over PeerTransport, but that subscription never
    // reaches the host's mod client — so unless the host is itself subscribed,
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
      if (message.type === "stream-data") {
        cacheRef.current.set(message.topic, message);
      }
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
