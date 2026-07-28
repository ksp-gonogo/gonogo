import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  classifyRetained,
  type InFlightCommand,
  type PathConnectedDuring,
  type PendingEntry,
} from "./command-delay";
import {
  type CommsLinkLike,
  ConnectivityHistory,
} from "./connectivity-history";
import {
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "./context";
import type { CommandStatus } from "./lifecycle";
import { useLatestValue } from "./use-stream";

/** Shared constant so `getSnapshot` returns a referentially stable value when
 * no command has been dispatched yet — a fresh object literal here would
 * make `useSyncExternalStore` believe the snapshot changes on every render
 * and loop forever. */
const IDLE: CommandStatus = { phase: "idle" };

/** Shared constant for the same reason as `IDLE` above — an empty `inFlight`
 * array must be referentially stable across renders that have nothing
 * in-flight, or every consumer re-renders needlessly. */
const NO_IN_FLIGHT: InFlightCommand[] = [];

/**
 * How long (real UT seconds) a dispatched id may go without EVER appearing
 * in `system.uplink.pending` before this hook gives up tracking it — the
 * graceful no-delay/LAN degradation path. A genuinely delayed command's
 * entry appears in the very next queue snapshot regardless of its own
 * `oneWaySeconds` (the reveal-gate stamps `dispatchedAt` the instant the
 * command leaves the ground station; only its RESOLUTION takes
 * `2*oneWaySeconds`), so this window only needs to outlast one queue
 * broadcast cycle, never a full round trip.
 */
const NEVER_TRACKED_GRACE_SECONDS = 5;

interface PendingUplinkQueueLike {
  pending: PendingEntry[];
}

export interface UseCommandResult {
  /**
   * `opts.label` is an opaque, operator-facing description of the command
   * (e.g. line-mode's composed line text) threaded straight through to
   * `TelemetryClient.dispatch`'s envelope — it plays no role in dispatch,
   * correlation, or loss inference.
   *
   * `opts.topic` is dispatch-time part/route addressing (e.g. `kos/<coreId>`
   * for a terminal-scoped command), threaded through the same way — no role
   * in dispatch, correlation, or loss inference.
   */
  send: (
    args?: unknown,
    opts?: { label?: string; topic?: string },
  ) => Promise<unknown>;
  status: CommandStatus;
  /**
   * Every dispatch this hook has made that hasn't yet resolved cleanly —
   * accumulated on `send` (not just the latest one), retained past the
   * moment `system.uplink.pending` ages an entry out of the live queue so
   * an `overdue`/`lost` command can't silently vanish. An entry is dropped
   * once it reaches `predictedPhase: "due"` under a connected path (assumed
   * arrived) — see `classifyRetained`'s own doc for the full rule. A
   * dispatch that never gets a queue entry at all (no-delay/LAN path) drops
   * silently after `NEVER_TRACKED_GRACE_SECONDS` instead of leaking forever.
   */
  inFlight: InFlightCommand[];
}

type TrackedResolution =
  | { kind: "classified"; item: InFlightCommand }
  /** No queue entry yet, but still within the never-tracked grace window — keep tracking, nothing to render yet. */
  | { kind: "waiting" }
  /** Reached `predictedPhase: "due"` under a connected path — assumed arrived, stop tracking. */
  | { kind: "resolved" }
  /** No queue entry ever arrived within the grace window — assume this dispatch never used the pending-uplink queue at all. */
  | { kind: "expired" };

/**
 * Resolve one tracked dispatch id against the live queue, this hook's own
 * entry cache, and (when never queued) the never-tracked grace clock.
 * Shared by the render-time `inFlight` computation and the prune effect
 * below so the two can never drift on what counts as resolved/expired.
 */
function resolveTracked(
  id: string,
  queue: PendingUplinkQueueLike | undefined,
  cache: Map<string, PendingEntry>,
  firstSeenAt: Map<string, number>,
  nowUt: number,
  pathConnectedDuring: PathConnectedDuring,
): TrackedResolution {
  const inQueue = queue?.pending.find((entry) => entry.id === id);
  if (inQueue) cache.set(id, inQueue);
  const entry = inQueue ?? cache.get(id);

  if (!entry) {
    const firstSeen = firstSeenAt.get(id);
    if (
      firstSeen !== undefined &&
      nowUt - firstSeen >= NEVER_TRACKED_GRACE_SECONDS
    ) {
      return { kind: "expired" };
    }
    return { kind: "waiting" };
  }

  const classified = classifyRetained({
    entry,
    nowUt,
    present: Boolean(inQueue),
    pathConnectedDuring,
  });
  if (classified.predictedPhase === "due") return { kind: "resolved" };
  return { kind: "classified", item: classified };
}

/**
 * Fires `command` against the `TelemetryClient` from the nearest
 * `TelemetryProvider` and reactively reflects its lifecycle
 * (`idle -> in-flight -> confirmed|failed`), plus this hook's OWN set of
 * in-flight dispatches (`inFlight`) — the delayed-command-ux primitive: a
 * command widget gets delay state for free from the same hook it already
 * calls to dispatch, no separate opt-in.
 *
 * The active `requestId` is held in React state so `send` can be called
 * more than once; `status` is read via `useSyncExternalStore` over
 * `client.subscribeStore`, so any status transition for the in-flight
 * request re-renders the caller. `inFlight` is a SEPARATE accumulating set
 * (not just the latest `requestId`) — see `UseCommandResult.inFlight`'s doc.
 */
export function useCommand(command: string): UseCommandResult {
  // Degrade gracefully with no `TelemetryProvider` mounted (disconnected):
  // status stays IDLE and `send` is a no-op — you can't dispatch a command
  // with no link, and the hook must not throw just because the dashboard
  // rendered before a connection exists.
  const client = useTelemetryClientOptional();
  const [requestId, setRequestId] = useState<string | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      client ? client.subscribeStore(onStoreChange) : () => {},
    [client],
  );

  const getSnapshot = useCallback(
    () => (client && requestId ? client.getCommand(requestId) : IDLE),
    [client, requestId],
  );

  const status = useSyncExternalStore(subscribe, getSnapshot);

  // --- inFlight bookkeeping: this hook's OWN dispatches, retained past a
  // queue age-out (Task 4 / Task 4a of the delayed-command-ux plan). ---
  const [dispatchedIds, setDispatchedIds] = useState<string[]>([]);
  const entryCacheRef = useRef<Map<string, PendingEntry>>(new Map());
  const firstSeenAtRef = useRef<Map<string, number>>(new Map());
  const connectivityHistoryRef = useRef<ConnectivityHistory>(
    new ConnectivityHistory(),
  );

  const queue = useLatestValue<PendingUplinkQueueLike>("system.uplink.pending");
  const connectivity = useLatestValue<CommsLinkLike>("comms.link");
  // A synchronous, NON-subscribing read of the same undelayed clock
  // `useUtNow` tracks (`ViewClock.utNowEstimate()`) — deliberately NOT
  // `useUtNow()` itself, which subscribes to a real-wall-clock ~16ms tick
  // for the component's whole mounted lifetime. That per-frame subscription
  // is unnecessary here: `nowUt` only needs to be fresh AT the renders this
  // hook already causes (a queue/connectivity change, a status transition),
  // and the visual per-second countdown smoothing is `InFlightList`'s own
  // `useCountdown` value-hook's job, not this hook's. Avoiding the
  // independent real-timer subscription also avoids a real hazard it
  // otherwise creates: under load, that timer can fire outside any test's
  // `act()` boundary for every mounted `useCommand` caller, regardless of
  // whether the test ever touches `inFlight`.
  const store = useTelemetryStoreOptional();
  const nowUt = store?.clock.utNowEstimate() ?? 0;

  if (connectivity) {
    connectivityHistoryRef.current.record(nowUt, connectivity.connected);
  }

  const pathConnectedDuring: PathConnectedDuring = useCallback(
    (fromUt: number, toUt: number) =>
      connectivityHistoryRef.current.connectedDuring(fromUt, toUt),
    [],
  );

  // Latest `nowUt` by ref, read from `send` below — `send` is a stable
  // `useCallback` (keyed on `[client, command]` only, same as before this
  // task), so it can't close over the freshly-computed render-scope value.
  const nowUtRef = useRef(nowUt);
  nowUtRef.current = nowUt;

  let inFlight = NO_IN_FLIGHT;
  if (dispatchedIds.length > 0) {
    const computed: InFlightCommand[] = [];
    for (const id of dispatchedIds) {
      const resolution = resolveTracked(
        id,
        queue,
        entryCacheRef.current,
        firstSeenAtRef.current,
        nowUt,
        pathConnectedDuring,
      );
      if (resolution.kind === "classified") computed.push(resolution.item);
    }
    if (computed.length > 0) inFlight = computed;
  }

  // Prune tracked ids once resolved/expired, so `dispatchedIds` (and the
  // caches it drives) don't grow forever over a long session. Separate from
  // the render-time `inFlight` computation above so a resolved id
  // disappears from the rendered set immediately (this render) even before
  // the prune effect commits the smaller tracked-id array (next render).
  //
  // Deliberately NOT keyed on `nowUt`: reading `store.clock.utNowEstimate()`
  // synchronously (see above) means `nowUt` is a fresh value on literally
  // EVERY render, for ANY reason — keying this effect on it would refire
  // the prune on every single render of every mounted `useCommand` caller,
  // whether or not anything relevant changed. The render-time `inFlight`
  // computation above already hides a resolved entry immediately using the
  // current `nowUt`, regardless of whether this effect has caught up yet —
  // this effect only needs to run when something that could change a
  // resolution actually changed (`queue`, or the connectivity history via
  // `pathConnectedDuring`'s identity), reading the latest `nowUt` off the
  // ref at that point.
  useEffect(() => {
    setDispatchedIds((prev) => {
      const keep = prev.filter((id) => {
        const resolution = resolveTracked(
          id,
          queue,
          entryCacheRef.current,
          firstSeenAtRef.current,
          nowUtRef.current,
          pathConnectedDuring,
        );
        return (
          resolution.kind === "classified" || resolution.kind === "waiting"
        );
      });
      return keep.length === prev.length ? prev : keep;
    });
  }, [queue, pathConnectedDuring]);

  const send = useCallback(
    (args?: unknown, opts?: { label?: string; topic?: string }) => {
      if (!client) return Promise.resolve(undefined);
      const { requestId: newRequestId, result } = client.dispatch(
        command,
        args,
        opts?.label,
        opts?.topic,
      );
      setRequestId(newRequestId);
      firstSeenAtRef.current.set(newRequestId, nowUtRef.current);
      setDispatchedIds((prev) => [...prev, newRequestId]);
      return result;
    },
    [client, command],
  );

  return { send, status, inFlight };
}
