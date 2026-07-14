import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { type Clock, RealTimeClock } from "./clock";
import type { CommandStatus } from "./lifecycle";
import type { TimelineStore } from "./timeline-store";
import type { Transport } from "./transport";

type Callback = (value: unknown) => void;
type StoreListener = () => void;

/**
 * Grace period (UT seconds) added on top of a transport's predicted
 * `etaConfirm` before silence is inferred as loss. Sized to absorb small
 * scheduling jitter around the predicted round trip, not to model any
 * additional delay itself — the prediction already IS the round trip.
 */
export const LOSS_MARGIN = 2;

/**
 * One record per `subscribe()` call, not per callback identity — the same
 * callback reference can be passed to `subscribe` multiple times and each
 * call must ref-count independently (see `off()` in `subscribe`).
 */
interface Subscription {
  cb: Callback;
}

/**
 * Bookkeeping for one dispatched command, in-flight or settled.
 *
 * `resolve`/`reject` are nulled once the command settles (confirmed/failed)
 * — the Promise they close over has already been settled by then, so
 * holding onto them serves no purpose beyond leaking closures and inviting a
 * duplicate late `command-response`/`error` to re-settle (and silently
 * overwrite) an already-terminal `status`. The entry itself is intentionally
 * NOT deleted from `commands` on settle: `getCommand` must keep returning
 * the terminal status forever after, and deleting it would make an unknown
 * request look identical to a *known, settled* one (both would read back as
 * `{ phase: "idle" }`), which reverts `useCommand`'s `getSnapshot` to a
 * fresh object identity on every call and infinite-loops
 * `useSyncExternalStore`.
 */
interface PendingCommand {
  status: CommandStatus;
  resolve: ((result: unknown) => void) | null;
  reject: ((error: { code: string; message: string }) => void) | null;
  /**
   * Cancels this command's loss-inference timer (only set when the
   * transport predicted an `etaConfirm`). Called whenever the command
   * settles by any other means (response, error, or dispose) so a command
   * that already confirmed/failed can never later flip to `lost`. `null`
   * once cancelled (or if no timer was ever scheduled, e.g. `StubTransport`).
   */
  cancelLossTimer: (() => void) | null;
}

/**
 * App-side core that wraps a `Transport` and manages topic subscriptions.
 *
 * Ref-counts subscribers per topic so `transport.send` is only asked to
 * subscribe/unsubscribe on the first-in/last-out transition, keeps a sticky
 * last-value store so late subscribers see the current value immediately,
 * and exposes a store-listener channel for `useSyncExternalStore`-style React
 * hooks (added in a later task). Command dispatch is out of scope here.
 */
export class TelemetryClient {
  private readonly transport: Transport;
  private readonly clock: Clock;
  private readonly subscribers = new Map<string, Set<Subscription>>();
  private readonly lastValues = new Map<string, unknown>();
  private readonly storeListeners = new Set<StoreListener>();
  private readonly unsubscribeFromTransport: () => void;
  private readonly commands = new Map<string, PendingCommand>();
  private nextRequestId = 0;
  /** Raw-frame tap listeners — see `onRawMessage`. */
  private readonly rawMessageListeners = new Set<
    (message: ServerMessage) => void
  >();
  /**
   * `TimelineStore`s fed from this client's wire. A `Set`, not a single
   * slot — nothing stops more than one screen from
   * sharing a client, and each gets its own `TimelineStore`/`ViewClock`. In
   * practice `TelemetryProvider` attaches exactly one (the store it
   * auto-builds, or a caller-supplied one).
   */
  private readonly stores = new Set<TimelineStore>();

  /**
   * `clock` defaults to `RealTimeClock` — every real transport uses it
   * unmodified. Tests inject a deterministic `Clock` (or a structurally
   * compatible one, like sitrep-server's `ManualClock`) so loss-inference
   * timing is controllable instead of racing real timers.
   *
   * Whichever `Clock` is injected MUST share the same time domain as the
   * transport's `predictConfirmEta()` (the UT clock the server/courier
   * advances) — see the domain note on the `Clock` interface in `./clock`.
   * A mismatched domain makes loss inference meaningless: the
   * `etaConfirm - now()` delta can clamp to zero (false near-instant "lost")
   * or never fire (loss never inferred).
   */
  constructor(transport: Transport, clock: Clock = new RealTimeClock()) {
    this.transport = transport;
    this.clock = clock;
    this.unsubscribeFromTransport = transport.onMessage((message) => {
      for (const listener of this.rawMessageListeners) listener(message);
      this.handleMessage(message);
    });
  }

  /**
   * Tap every raw wire message this client's transport delivers, verbatim
   * and in arrival order — BEFORE this class's own topic-routing/store-ingest
   * handling runs on it (`handleMessage` drops `command-response`/`error`
   * after its own bookkeeping and silently ignores `event` frames entirely,
   * so a listener that only used `subscribe`/`getValue` could never observe
   * either). This is the mission-recording tap point (`StreamRecorder`,
   * `./replay-recorder.ts`): recording a session needs the SAME
   * `stream-data`/`event` frames a `ReplayFixture` replays later, not the
   * flattened last-value view every other consumer of this class sees.
   *
   * Purely additive — does not affect `subscribe`/`getValue`/store-ingest
   * delivery, and costs nothing when no listener is registered (the common
   * case: mission history off, or no recorder attached).
   */
  onRawMessage(listener: (message: ServerMessage) => void): () => void {
    this.rawMessageListeners.add(listener);
    return () => this.rawMessageListeners.delete(listener);
  }

  /**
   * Subscribe to a topic. On the first subscriber for a topic, sends a
   * `subscribe` message to the transport. If a sticky last value already
   * exists for the topic, `cb` is invoked with it synchronously before
   * returning. Returns an unsubscribe function; when the last subscriber for
   * the topic unsubscribes, sends `unsubscribe` and clears local state.
   */
  subscribe(topic: string, cb: Callback): () => void {
    let subs = this.subscribers.get(topic);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(topic, subs);
      this.transport.send({ type: "subscribe", topic });
    }
    const sub: Subscription = { cb };
    subs.add(sub);

    if (this.lastValues.has(topic)) {
      this.invokeCallback(cb, this.lastValues.get(topic));
    }

    return () => {
      const current = this.subscribers.get(topic);
      if (!current) return;
      current.delete(sub);
      if (current.size === 0) {
        this.subscribers.delete(topic);
        this.lastValues.delete(topic);
        this.transport.send({ type: "unsubscribe", topic });
      }
    };
  }

  /** Current sticky last value for a topic, if any has been received. */
  getValue(topic: string): unknown {
    return this.lastValues.get(topic);
  }

  /**
   * The topics the underlying `Transport` declares it actually delivers
   * (see the carried-channels allowlist gate, `./carried-channels.ts`) —
   * `[]` when the transport doesn't declare (`Transport.carriedChannels`
   * omitted, e.g. `StubTransport`). `TelemetryProvider` reads this to seed its
   * carried-channels allowlist; nothing else on this class depends on it.
   */
  get declaredChannels(): readonly string[] {
    return this.transport.carriedChannels ?? [];
  }

  /**
   * Feed this client's raw `stream-data` wire frames into `store`: from
   * this call on, every future `stream-data`
   * message is ALSO delivered to `store.ingest(topic, point)`, in addition
   * to the existing `lastValues`/per-topic-subscriber delivery this class
   * already does — the two delivery paths are independent, neither replaces
   * the other. `point.validAt`/`point.epoch` are read straight off the
   * message's own `meta` (`meta.validAt`/`meta.timelineEpoch`), which is what
   * makes this feed correct for a derived channel's epoch-guard/quality-pick
   * machinery without this class needing to know anything about derivation.
   *
   * Does NOT replay history: a store attached after samples have already
   * arrived only sees samples from that point forward (this class keeps no
   * raw-message log, only the flattened `lastValues` sticky cache) — matches
   * `TelemetryProvider`'s own lifecycle, which attaches its store before
   * anything can possibly subscribe through it.
   *
   * Returns a detach function. Safe to attach more than one store to the
   * same client (each gets every message independently); a client is not
   * scoped to exactly one `TimelineStore`.
   */
  attachStore(store: TimelineStore): () => void {
    this.stores.add(store);
    return () => {
      this.stores.delete(store);
    };
  }

  /**
   * Subscribe to "something changed" notifications, independent of topic.
   * Used by reactive-store plumbing (e.g. `useSyncExternalStore`).
   */
  subscribeStore(cb: StoreListener): () => void {
    this.storeListeners.add(cb);
    return () => this.storeListeners.delete(cb);
  }

  /**
   * Dispatch a command to the server. Returns immediately with a
   * `requestId` (a monotonic `c${n}` counter, never random/time-based, so
   * ordering is deterministic and testable) and a `result` Promise that
   * resolves/rejects once the correlated `command-response`/`error` arrives.
   *
   * `transport.send` is called synchronously — the client always hands the
   * request to the transport in the same tick as `dispatch()`. Modeling the
   * round trip (i.e. making sure `in-flight` is observable before the
   * response settles) is the transport's responsibility, not the client's:
   * even a zero-latency stub must answer on a later tick, since a real
   * transport never resolves in the same call stack as the request.
   *
   * Loss inference: the client asks the transport to *predict* an
   * `etaConfirm` (never computes delay itself). When the transport can't
   * predict one (`predictConfirmEta` omitted or returning `undefined`, e.g.
   * `StubTransport`), `etaConfirm` falls back to "now" and no loss timer is
   * started — the command just waits. When a prediction IS
   * available, a loss timer is armed for `etaConfirm + LOSS_MARGIN`; if the
   * command is still `in-flight` when it fires, silence is inferred as
   * `lost` and the promise rejects. Any real settle (response or error)
   * cancels that timer first, so a confirmed/failed command can never later
   * flip to `lost`.
   *
   * `label` is an opaque, operator-facing description of the command
   * (e.g. the composed line text for a line-mode `kos.keystroke`) carried
   * straight through on the envelope — it plays no role in dispatch,
   * correlation, or loss inference. Defaults to `""` when omitted, matching
   * every pre-existing caller.
   */
  dispatch(
    command: string,
    args?: unknown,
    label?: string,
  ): { requestId: string; result: Promise<unknown> } {
    const requestId = `c${this.nextRequestId++}`;
    const predictedEta = this.transport.predictConfirmEta?.();
    const etaConfirm = predictedEta ?? this.clock.now();

    const result = new Promise<unknown>((resolve, reject) => {
      this.commands.set(requestId, {
        status: { phase: "in-flight", requestId, etaConfirm },
        resolve,
        reject,
        cancelLossTimer: null,
      });
    });

    if (predictedEta !== undefined) {
      const cancel = this.clock.schedule(predictedEta + LOSS_MARGIN, () =>
        this.handleLoss(requestId),
      );
      const pending = this.commands.get(requestId);
      if (pending) pending.cancelLossTimer = cancel;
    }

    this.notifyStore();
    this.transport.send({
      type: "command-request",
      requestId,
      command,
      label: label ?? "",
      // `topic` (dispatch-time part/route addressing) has no app-side
      // producer yet — always "" (unscoped) until a caller needs to target
      // a specific part/terminal, mirroring `label`'s own rollout.
      topic: "",
      args,
      sentAt: 0,
    });
    return { requestId, result };
  }

  /** Current lifecycle status for a dispatched command, or `idle` if unknown. */
  getCommand(requestId: string): CommandStatus {
    return this.commands.get(requestId)?.status ?? { phase: "idle" };
  }

  /**
   * Tear down the transport listener and clear all local state.
   *
   * Before clearing: sends `unsubscribe` for every topic that still has
   * active subscribers (the transport doesn't know the client is going
   * away otherwise), and rejects every still-pending command's `result`
   * promise with a disposed error, so callers awaiting `dispatch()` don't
   * hang forever on a client that will never receive their response.
   */
  dispose(): void {
    this.unsubscribeFromTransport();

    for (const topic of this.subscribers.keys()) {
      this.transport.send({ type: "unsubscribe", topic });
    }

    for (const [requestId, pending] of this.commands) {
      pending.cancelLossTimer?.();
      pending.cancelLossTimer = null;
      if (!pending.reject) continue; // already settled, nothing to reject
      const error = {
        code: "E_DISPOSED",
        message: "TelemetryClient disposed while command was in flight",
      };
      const reject = pending.reject;
      pending.status = { phase: "failed", requestId, error };
      pending.resolve = null;
      pending.reject = null;
      reject(error);
    }

    this.subscribers.clear();
    this.lastValues.clear();
    this.storeListeners.clear();
    this.commands.clear();
    this.stores.clear();
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === "command-response") {
      this.handleCommandResponse(message.requestId, message.result);
      return;
    }
    if (message.type === "error") {
      this.handleCommandError(message.requestId, message.code, message.message);
      return;
    }
    if (message.type !== "stream-data") return;
    this.lastValues.set(message.topic, message.payload);
    const subs = this.subscribers.get(message.topic);
    if (subs) {
      for (const sub of subs) this.invokeCallback(sub.cb, message.payload);
    }
    for (const store of this.stores) {
      store.ingest(message.topic, {
        validAt: message.meta.validAt,
        payload: message.payload,
        meta: message.meta,
        epoch: message.meta.timelineEpoch,
      });
    }
    this.notifyStore();
  }

  private handleCommandResponse(requestId: string, result: unknown): void {
    const pending = this.commands.get(requestId);
    // No entry (unknown requestId) or already settled (a duplicate/late
    // response) — either way there's no live resolve() to call, and a
    // duplicate must not clobber the terminal status already recorded.
    if (!pending?.resolve) return;
    pending.cancelLossTimer?.();
    pending.cancelLossTimer = null;
    const resolve = pending.resolve;
    pending.status = { phase: "confirmed", requestId, result };
    pending.resolve = null;
    pending.reject = null;
    resolve(result);
    this.notifyStore();
  }

  private handleCommandError(
    requestId: string | undefined,
    code: string,
    message: string,
  ): void {
    if (!requestId) return;
    const pending = this.commands.get(requestId);
    if (!pending?.reject) return;
    pending.cancelLossTimer?.();
    pending.cancelLossTimer = null;
    const error = { code, message };
    const reject = pending.reject;
    pending.status = { phase: "failed", requestId, error };
    pending.resolve = null;
    pending.reject = null;
    reject(error);
    this.notifyStore();
  }

  /**
   * Fires when a command's loss-inference timer reaches `etaConfirm +
   * LOSS_MARGIN` with no response yet. A no-op if the command has already
   * settled (or is unknown) — the timer is always cancelled on settle, but
   * this guard covers the case where cancellation and firing raced within
   * the same clock-driven callback batch.
   */
  private handleLoss(requestId: string): void {
    const pending = this.commands.get(requestId);
    if (!pending || pending.status.phase !== "in-flight") return;
    const reject = pending.reject;
    pending.status = { phase: "lost", requestId, reason: "signal-lost" };
    pending.resolve = null;
    pending.reject = null;
    pending.cancelLossTimer = null;
    reject?.({
      code: "E_LOST",
      message: "command lost: no confirmation received by predicted ETA",
    });
    this.notifyStore();
  }

  private notifyStore(): void {
    for (const listener of this.storeListeners) listener();
  }

  /** Invoke a single subscriber callback, isolating one throw from the rest of fan-out. */
  private invokeCallback(cb: Callback, payload: unknown): void {
    try {
      cb(payload);
    } catch (error) {
      // A throwing subscriber must not break delivery to sibling subscribers
      // or skip the store-notify that follows. TODO: route through the
      // shared logger once one exists for this package.
      console.error("TelemetryClient: subscriber callback threw", error);
    }
  }
}
