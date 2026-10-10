import { PerfBudget } from "@ksp-gonogo/core";
import { useTelemetryClientOptional } from "@ksp-gonogo/sitrep-client";
import type { ServerMessage, StreamData } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useRef, useState } from "react";
import { isTransmission } from "../commcast/topics";
import { HOST_SESSION, type PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";

/**
 * The Uplink roster. A station reads it to know which bundles to load, which is
 * the one thing it cannot discover by mounting a widget, so the relay holds it
 * on the station's behalf. Declared by the engine itself rather than by any
 * Uplink's manifest, so it belongs to no mod.
 */
const BOOTSTRAP_TOPIC = "system.uplinks";

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

/**
 * Frames kept per topic for a station that subscribes late. The main screen's
 * own timeline keeps 1500 points per topic, so a station given the same run
 * plots the same trace.
 */
const HISTORY_PER_TOPIC = 1500;

/**
 * The game saying it is loading, at its menu, or ready. A fact about the game
 * on the machine and not about any command centre's view of it, so it carries
 * no vantage and goes to every peer, not only those reading from the host's own
 * session.
 */
function isGameState(
  message: ServerMessage,
): message is Extract<ServerMessage, { type: "game-state" }> {
  return message.type === "game-state";
}

function isCarriedFrame(message: ServerMessage): boolean {
  return (
    message.type === "stream-data" ||
    message.type === "stream-binary" ||
    message.type === "event"
  );
}

/**
 * Host-side stream forwarding: taps the host's own live `TelemetryClient`
 * (via `useTelemetryClientOptional()`: the SAME client instance
 * `SitrepTelemetryProvider` mounted, never a second connection to the mod)
 * and relays every `stream-data`/`stream-binary`/`event`/`game-state` frame it receives VERBATIM to every
 * connected station, wrapped in a `sitrep-frame` envelope. Architecturally a
 * live sibling of `StreamRecorder` (`@ksp-gonogo/sitrep-client`): instead of
 * pushing frames into an array for later replay, it pushes them onto the
 * PeerJS wire.
 *
 * Renders nothing. Mount as a child of `<SitrepTelemetryProvider>` (needs to
 * be inside the provider's subtree to read the live client); see
 * `MainScreen.tsx`.
 *
 * Upstream subscription is DEMAND-DRIVEN, and that is the only way a topic gets
 * pulled: `attachSitrepSink` hands `PeerHostService` the ability to hold a
 * `client.subscribe(topic, noop)` keep-alive, and the host holds one per topic
 * any connected station says it is reading. The no-op callbacks carry nothing;
 * delivery happens off the `onRawMessage` tap below. The relay subscribes to
 * nothing on its own account except the bootstrap floor named below, so a
 * station reaches a topic because a widget on it asked, never because the topic
 * appears on a list somebody maintained.
 *
 * What throttles the pull is therefore the refcount alone, and what re-syncs
 * that refcount when a station leaves without saying so is
 * `PeerHostService.reconcileSitrepSubs` plus the host's ICE liveness detector.
 *
 * Backfill: keeps its own run of the last `HISTORY_PER_TOPIC` frames per
 * topic, filled from mount rather than from the first station's arrival, and
 * cleared only when the client is rebuilt, so it stays useful across a
 * connect/disconnect gap. A NEWLY connecting peer is sent the newest frame of
 * each topic alone (`sendToPeer`, never `broadcast`), and a station that
 * subscribes a topic the host was already holding is sent the whole run, so
 * neither sits blank on a low-rate topic that has not changed since it asked
 * and a chart starts with the trace the main screen drew. The station
 * discards a frame it has already ingested. `event` frames and
 * transmissions are one-shot by nature and deliberately NOT backfilled, same posture as
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
  // (cleared only when the client is rebuilt) so a station reconnecting after a gap
  // still gets the last-known value immediately.
  const cacheRef = useRef(new Map<string, StreamData<unknown>[]>());
  // The newest word on what the game is doing. Held apart from the frame cache because it is keyed by no topic, and kept for the same reason: a station arriving mid-load must hold at once, and no later frame is coming to tell it.
  const gameStateRef = useRef<ServerMessage | undefined>(undefined);

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

  // Per-connection backfill, independent of the `hasConnections` gating below:
  // whatever the host has seen so far is replayed to the arriving connection
  // alone, so a station joining mid-flight is not blank on a topic that last
  // changed before it got here.
  useEffect(() => {
    return peerHost.onPeerConnect((peerId) => {
      for (const run of cacheRef.current.values()) {
        const newest = run[run.length - 1];
        if (!newest) continue;
        peerHost.sendToPeer(peerId, {
          type: "sitrep-frame",
          message: newest,
        } satisfies PeerMessage);
      }
      if (gameStateRef.current) {
        peerHost.sendToPeer(peerId, {
          type: "sitrep-frame",
          message: gameStateRef.current,
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
  // Caching from mount is what makes `cachedFrames` able to answer.
  const previousClient = useRef<typeof client>(undefined);
  useEffect(() => {
    if (!client) return;
    // A rebuilt client is a new game process, whose frames carry a lower epoch than anything cached from the last: replaying those would make a station's fresh store refuse the new game.
    if (previousClient.current && previousClient.current !== client) {
      cacheRef.current.clear();
      gameStateRef.current = undefined;
      peerHost.broadcast({ type: "sitrep-reset" } satisfies PeerMessage);
    }
    previousClient.current = client;
    return client.onRawMessage((message) => {
      if (message.type === "stream-data" && !isTransmission(message)) {
        let run = cacheRef.current.get(message.topic);
        if (!run) {
          run = [];
          cacheRef.current.set(message.topic, run);
        }
        run.push(message);
        if (run.length > HISTORY_PER_TOPIC) run.shift();
      }
      if (isGameState(message)) gameStateRef.current = message;
    });
  }, [client, peerHost]);

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
      cachedFrames: (topic) =>
        (cacheRef.current.get(topic) ?? []).map(
          (message) =>
            ({ type: "sitrep-frame", message }) satisfies PeerMessage,
        ),
    });
  }, [client, peerHost]);

  useEffect(() => {
    if (!client || !hasConnections) return;
    // The bootstrap floor, and the whole of it. A station with nothing mounted
    // correctly asks for nothing, but it cannot mount its Uplinks' widgets
    // until it has read the roster, and it cannot read the roster off a topic
    // nobody is pulling. Holding it from the moment a station connects also
    // warms the frame cache, so the station's own roster read is answered from
    // the replay rather than waiting on the mod's next emission.
    //
    // `system.uplinks` is the engine's own channel, so pinning it names no mod
    // and privileges nothing: every other topic, first-party or not, reaches a
    // station only because a mounted widget asked for it.
    const unsubBootstrap = client.subscribe(BOOTSTRAP_TOPIC, () => {});

    const detachRaw = client.onRawMessage((message) => {
      if (isGameState(message)) {
        peerHost.broadcast({
          type: "sitrep-frame",
          message,
        } satisfies PeerMessage);
        return;
      }
      if (!isCarriedFrame(message)) return;
      SITREP_PEER_RELAY_BUDGET.record();
      // To the connections reading from the HOST's session only. A peer that
      // asked to observe from somewhere else is served by the session at that
      // vantage, and handing it these frames as well would give it two views
      // of one topic with no way to tell them apart: a frame does not carry
      // the delay it travelled under.
      peerHost.broadcastToVantage(HOST_SESSION, {
        type: "sitrep-frame",
        message,
      } satisfies PeerMessage);
    });
    return () => {
      detachRaw();
      unsubBootstrap();
    };
  }, [client, hasConnections, peerHost]);

  return null;
}
