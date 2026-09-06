import { CommandErrorCode, type LimitBreach } from "../__generated__/contract";
import {
  COMMAND_LOST,
  COMMAND_REFUSED,
  COMMAND_UNDELIVERED,
} from "../api/command-rejection";
import type { Transport } from "../api/transport";
import type { ServerMessage } from "../envelope";
import { warnChannelError } from "./channel-error-warning";
import { type Clock, RealTimeClock } from "./clock";
import { CommandError, type CommandStatus } from "./lifecycle";
import type { TimelineStore } from "./timeline-store";
import { type TopicOwnership, TopicOwnershipTracker } from "./topic-ownership";
import { META_VANTAGE } from "./vantage";

type Callback = (value: unknown) => void;
type StoreListener = () => void;

/**
 * Grace period (UT seconds) added on top of the predicted `etaConfirm` before
 * silence is inferred as loss. Sized to absorb small scheduling jitter around the
 * predicted round trip, not to model any additional delay itself: the prediction
 * already IS the round trip.
 *
 * **Shared with `classifyRetained`'s `overdueMarginSeconds`, deliberately.** Two
 * layers judge the same silence about the same command, so they judge it on ONE
 * number. Two (2s here, 3s there) is how a command ends up `lost` to an awaiting
 * caller while the queue still calls it merely late.
 *
 * They still differ in PURPOSE, which is why both exist and neither is redundant:
 *
 * - here, the client settles the dispatch PROMISE. That is a liveness guarantee: an
 *   `await` must end, or a caller that loops over dispatches stalls for ever
 *   (`ManeuverPlanner.dispatchPlanBurns` abandoning burns 2..n was exactly this)
 * - in `classifyRetained`, the hook DIAGNOSES the silence, distinguishing `lost`
 *   (the path was down) from `overdue` (the path was up and nothing acked). It knows
 *   things the client does not: queue presence and `comms.link` history
 *
 * So: one authority for the delay, one margin, two consumers with different jobs.
 * Do not "unify" them further by deleting one; the promise needs settling whether or
 * not anything is rendering, and the diagnosis needs inputs the client has no
 * business subscribing to.
 */
export const LOSS_MARGIN = 3;

/**
 * One record per `subscribe()` call, not per callback identity, the same
 * callback reference can be passed to `subscribe` multiple times and each
 * call must ref-count independently (see `off()` in `subscribe`).
 */
interface Subscription {
  cb: Callback;
}

/**
 * Bookkeeping for one dispatched command, in-flight or settled.
 *
 * `resolve`/`reject` are nulled once the command settles (confirmed/failed/lost),
 * the Promise they close over has already been settled by then, so
 * holding onto them serves no purpose beyond leaking closures and inviting a
 * duplicate late `command-response`/`error` to re-settle (and silently
 * overwrite) an already-terminal `status`. The entry itself is intentionally
 * NOT deleted from `commands` on settle: `getCommand` must keep returning
 * the terminal status forever after, and deleting it would make an unknown
 * request look identical to a *known, settled* one (both would read back as
 * `{ phase: "idle" }`), which reverts `useCommand`'s `getSnapshot` to a
 * fresh object identity on every call and infinite-loops
 * `useSyncExternalStore`.
 *
 * That retention is what makes `found` possible, and the two channels this
 * record carries are why it costs no promise gymnastics. The PROMISE is a
 * one-shot await, "did my call settle", and settling it as `lost` is honest and
 * final: the caller genuinely did stop waiting, and nothing here ever settles it
 * twice. The `status`, read through `getCommand` and republished by
 * `notifyStore`, is the LIVING state the delay rail renders, and it is free to
 * move again. So a reply arriving after the loss writes a further status and
 * notifies, while the nulled `resolve`/`reject` keep the promise exactly as it
 * was.
 */
interface PendingCommand {
  /**
   * What was dispatched, kept so a refusal can NAME it. Without these three a
   * refusal could only ever say "command refused: ModeUnavailable": the reply
   * carries a `requestId` and a reason and deliberately no command name, so
   * this is the ONLY place the name still exists once the request has left.
   *
   * Retained client-side rather than added to the wire on purpose. The mod
   * already told us what we asked it; asking it to say so again would be paying
   * for a fact we threw away.
   */
  command: string;
  args: unknown;
  /** The dispatch's own operator-facing description, when it carried one. */
  label: string;
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
/**
 * The `CommandErrorCode` a `command-response` payload is refusing with, or
 * `null` if it is not a refusal at all.
 *
 * Structural rather than nominal, because `CommandResult` is only one of the
 * shapes carried on this channel (an Uplink may answer its own). So a payload
 * with no `success` field is "not a CommandResult", never "refused": reading
 * absence as refusal would break every command that answers a bare value. Only
 * an explicit `success: false` counts.
 *
 * A refusal that somehow arrives without a usable `errorCode` still counts as
 * one, reported as `Unknown`: that we were refused is the load-bearing half,
 * and inventing a success out of a missing reason is the bug this whole path
 * exists to stop.
 */
function refusalOf(result: unknown): {
  errorCode: CommandErrorCode;
  breach?: LimitBreach;
  detail?: string;
} | null {
  if (typeof result !== "object" || result === null) return null;
  const candidate = result as {
    success?: unknown;
    errorCode?: unknown;
    breach?: unknown;
    detail?: unknown;
  };
  if (candidate.success !== false) return null;
  return {
    errorCode:
      typeof candidate.errorCode === "number"
        ? (candidate.errorCode as CommandErrorCode)
        : CommandErrorCode.Unknown,
    // The comparison behind the code, when the refusal had one. Absent is the
    // shape a reader keys on: an arm with no breach says the general thing
    // rather than rendering zeroes as a real limit of 0.
    breach:
      typeof candidate.breach === "object" && candidate.breach !== null
        ? (candidate.breach as LimitBreach)
        : undefined,
    // The game's own words, when it gave any. Empty is treated as absent for
    // the same reason: a refusal that quotes nothing must not render an empty
    // clause where a sentence was expected.
    detail:
      typeof candidate.detail === "string" && candidate.detail.length > 0
        ? candidate.detail
        : undefined,
  };
}

export class TelemetryClient {
  private readonly transport: Transport;
  private readonly clock: Clock;
  private readonly subscribers = new Map<string, Set<Subscription>>();
  private readonly lastValues = new Map<string, unknown>();
  private readonly storeListeners = new Set<StoreListener>();
  /** Reactive-read listeners for the selected vantage: see `onSelectedVantageChange`. */
  private readonly vantageListeners = new Set<() => void>();
  /** Reactive-read listeners for the observed vantage: see `onObservedVantageChange`. */
  private readonly observedVantageListeners = new Set<() => void>();
  private readonly unsubscribeFromTransport: () => void;
  private readonly unsubscribeFromTransportStatus: () => void;
  /** No-op for a transport with no queue to strand anything in: see `Transport.onUndelivered`. */
  private readonly unsubscribeFromUndelivered: () => void;
  /** No-op for a transport carrying nobody else's verdict: see `Transport.onLost`. */
  private readonly unsubscribeFromLost: () => void;
  private readonly commands = new Map<string, PendingCommand>();
  private nextRequestId = 0;
  private selectedVantageId = "ksc";
  private observedVantageId: string | undefined;
  /** Raw-frame tap listeners: see `onRawMessage`. */
  private readonly rawMessageListeners = new Set<
    (message: ServerMessage) => void
  >();
  /**
   * `TimelineStore`s fed from this client's wire. A `Set`, not a single
   * slot: nothing stops more than one screen from
   * sharing a client, and each gets its own `TimelineStore`/`ViewClock`. In
   * practice `TelemetryProvider` attaches exactly one (the store it
   * auto-builds, or a caller-supplied one).
   */
  private readonly stores = new Set<TimelineStore>();

  /**
   * Whether the mod has acked each subscribed topic, which is what separates
   * "nothing will ever publish this" from "it has not arrived yet".
   *
   * `undefined` when the transport does not relay acks (see
   * `Transport.decidesTopicOwnership`), and then every topic reads `undecided`
   * and no widget is ever told a topic is unowned. That is the safe direction
   * and the common one: only a connection that owns its own session with the
   * mod opts in.
   */
  private readonly ownership: TopicOwnershipTracker | undefined;

  /** Listeners for a topic reaching a verdict of unowned. See `onTopicUnowned`. */
  private readonly unownedListeners = new Set<(topic: string) => void>();
  /** Topic+code pairs already reported by `warnChannelError`, once per session. */
  private readonly channelErrorsWarned = new Set<string>();

  /**
   * Which widgets are reading each topic, refcounted, so the unowned warning
   * can name the widget as well as the topic.
   *
   * Diagnostics only: nothing about delivery consults it, and a topic read
   * outside a widget carries no label and simply is not in here. Refcounted
   * rather than a plain set because two instances of one widget id both
   * subscribing and one unmounting must not erase the label for the other.
   */
  private readonly subscriberLabels = new Map<string, Map<string, number>>();

  /**
   * `clock` defaults to `RealTimeClock`: every real transport uses it
   * unmodified. Tests inject a deterministic `Clock` (or a structurally
   * compatible one, like sitrep-server's `ManualClock`) so loss-inference
   * timing is controllable instead of racing real timers.
   *
   * Whichever `Clock` is injected MUST share the same time domain as the
   * transport's `predictConfirmEta()` (the UT clock the server/courier
   * advances): see the domain note on the `Clock` interface in `./clock`.
   * A mismatched domain makes loss inference meaningless: the
   * `etaConfirm - now()` delta can clamp to zero (false near-instant "lost")
   * or never fire (loss never inferred).
   */
  constructor(transport: Transport, clock: Clock = new RealTimeClock()) {
    this.transport = transport;
    this.clock = clock;
    this.ownership = transport.decidesTopicOwnership
      ? new TopicOwnershipTracker((topic) => {
          for (const listener of this.unownedListeners) listener(topic);
          for (const store of this.stores) store.markTopicUnowned(topic);
          this.notifyStore();
        })
      : undefined;
    this.unsubscribeFromTransport = transport.onMessage((message) => {
      for (const listener of this.rawMessageListeners) listener(message);
      this.handleMessage(message);
    });
    this.unsubscribeFromUndelivered =
      transport.onUndelivered?.((command) =>
        this.handleUndelivered(command.requestId, command.reason),
      ) ?? (() => undefined);
    this.unsubscribeFromLost =
      transport.onLost?.((command) =>
        this.handleLoss(
          command.requestId,
          "relayed-loss",
          `command lost: ${command.reason}`,
        ),
      ) ?? (() => undefined);
    this.unsubscribeFromTransportStatus = transport.onStatusChange((status) => {
      if (!this.ownership) return;
      if (status === "connected") {
        // The transports re-send their whole subscription set on every connect,
        // and the mod's session (with its ack bookkeeping) is new, so every
        // still-subscribed topic needs a fresh window against it.
        this.ownership.handleConnected(this.subscribers.keys());
        return;
      }
      // A subscribe whose ack was still in flight when the link dropped must
      // not mature into a verdict while nothing can answer.
      this.ownership.handleDisconnected();
      for (const store of this.stores) store.clearTopicOwnership();
      this.notifyStore();
    });
  }

  /**
   * Notified once per topic per connection, the moment the mod's silence has
   * gone on long enough to be an answer.
   *
   * Fires for the diagnostic surfaces (the logged warning) rather than for
   * rendering: a widget learns the same fact through its `Reading` arm, which is
   * the surface that makes it unmissable.
   */
  onTopicUnowned(listener: (topic: string) => void): () => void {
    this.unownedListeners.add(listener);
    return () => this.unownedListeners.delete(listener);
  }

  /**
   * What this connection can say about whether anything will ever publish
   * `topic`. Always `"undecided"` on a transport that does not relay acks.
   */
  topicOwnership(topic: string): TopicOwnership {
    return this.ownership?.ownershipOf(topic) ?? "undecided";
  }

  /**
   * Record that `label` (a widget id) is reading `topic`, for diagnostics.
   * Returns a release function; call it when the read stops.
   */
  noteSubscriberLabel(topic: string, label: string): () => void {
    let labels = this.subscriberLabels.get(topic);
    if (!labels) {
      labels = new Map();
      this.subscriberLabels.set(topic, labels);
    }
    labels.set(label, (labels.get(label) ?? 0) + 1);
    return () => {
      const current = this.subscriberLabels.get(topic);
      const count = current?.get(label);
      if (!current || count === undefined) return;
      if (count > 1) {
        current.set(label, count - 1);
        return;
      }
      current.delete(label);
      if (current.size === 0) this.subscriberLabels.delete(topic);
    };
  }

  /** The widgets currently reading `topic`, by id. Empty outside a widget. */
  readersOf(topic: string): readonly string[] {
    return [...(this.subscriberLabels.get(topic)?.keys() ?? [])];
  }

  /**
   * Tap every raw wire message this client's transport delivers, verbatim
   * and in arrival order: BEFORE this class's own topic-routing/store-ingest
   * handling runs on it (`handleMessage` drops `command-response`/`error`
   * after its own bookkeeping and silently ignores `event` frames entirely,
   * so a listener that only used `subscribe`/`getValue` could never observe
   * either). This is the mission-recording tap point (`StreamRecorder`,
   * `./replay-recorder.ts`): recording a session needs the SAME
   * `stream-data`/`event` frames a `ReplayFixture` replays later, not the
   * flattened last-value view every other consumer of this class sees.
   *
   * Purely additive: does not affect `subscribe`/`getValue`/store-ingest
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
  /**
   * The command centre this connection commands from and observes at (Plan 3).
   * Defaults to `"ksc"` until {@link setVantage} selects another.
   */
  get selectedVantage(): string {
    return this.selectedVantageId;
  }

  /**
   * Whether {@link setVantage} can do anything on this connection. False on a
   * station, whose frames are relayed from a host session it does not own, so a
   * surface there states {@link observedVantage} rather than offering a choice
   * that cannot be made.
   */
  get canSetVantage(): boolean {
    return this.transport.carriesVantage !== false;
  }

  /**
   * The command centre the mod stamped on the most recent ordinary frame, or
   * `undefined` before one has arrived.
   *
   * Where {@link selectedVantage} is intent (what this client asked for), this
   * is observation (what it is being sent). The two differ wherever a client
   * does not own the session its frames come from: a station's own selection is
   * a constructor default that can never move, so it names the right centre
   * only by luck, while every frame carries the vantage it was genuinely
   * delayed from.
   *
   * Instant-class topics ride the meta vantage instead of the session's
   * selection, so a frame stamped with it says nothing about where the session
   * is observing from and never moves this.
   */
  get observedVantage(): string | undefined {
    return this.observedVantageId;
  }

  /**
   * Subscribe to selected-vantage changes, so a component can re-render on one
   * without owning the selection itself. Fires after {@link setVantage} updates
   * the selection. Returns an unsubscribe.
   */
  onSelectedVantageChange(cb: () => void): () => void {
    this.vantageListeners.add(cb);
    return () => {
      this.vantageListeners.delete(cb);
    };
  }

  /**
   * Subscribe to observed-vantage changes (for a reactive read, e.g.
   * `@ksp-gonogo/sitrep-client`'s `useObservedVantage`). Fires only when an
   * arriving frame names a different
   * centre than the last one did, not on every frame. Returns an unsubscribe.
   */
  onObservedVantageChange(cb: () => void): () => void {
    this.observedVantageListeners.add(cb);
    return () => {
      this.observedVantageListeners.delete(cb);
    };
  }

  /**
   * Select the command centre (vantage) to command from and observe at. Sends a
   * `set-vantage` message and re-subscribes every active topic so its downlink
   * cursor re-points to the new vantage's offset. The server validates the id
   * (the default `"ksc"` is always accepted) and errors on an inactive centre;
   * this optimistically tracks the request.
   */
  setVantage(centreId: string): void {
    // A transport that cannot carry the selection must not have one made
    // against it. Changing `selectedVantageId` anyway would leave every reader
    // of it, the vantage control included, naming a command centre the data is
    // not from; and the re-subscribe below would churn the whole topic set for
    // a request nothing will act on.
    if (!this.canSetVantage) return;
    this.selectedVantageId = centreId;
    for (const listener of this.vantageListeners) listener();
    this.transport.send({ type: "set-vantage", centreId });
    // Re-point existing subscriptions at the new vantage: the server reads the
    // selected vantage at subscribe time, so an active topic must re-subscribe.
    for (const topic of this.subscribers.keys()) {
      this.transport.send({ type: "unsubscribe", topic });
      this.transport.send({ type: "subscribe", topic });
      this.ownership?.noteSubscribeSent(topic);
    }
  }

  subscribe(topic: string, cb: Callback): () => void {
    let subs = this.subscribers.get(topic);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(topic, subs);
      this.transport.send({ type: "subscribe", topic });
      this.ownership?.noteSubscribeSent(topic);
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
        this.ownership?.noteReleased(topic);
      }
    };
  }

  /** Current sticky last value for a topic, if any has been received. */
  getValue(topic: string): unknown {
    return this.lastValues.get(topic);
  }

  /**
   * The topics the underlying `Transport` declares it actually delivers
   * (see the carried-channels allowlist gate, `./carried-channels.ts`):
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
   * already does, the two delivery paths are independent, neither replaces
   * the other. `point.validAt`/`point.epoch` are read straight off the
   * message's own `meta` (`meta.validAt`/`meta.timelineEpoch`), which is what
   * makes this feed correct for a derived channel's epoch-guard/quality-pick
   * machinery without this class needing to know anything about derivation.
   *
   * Does NOT replay history: a store attached after samples have already
   * arrived only sees samples from that point forward (this class keeps no
   * raw-message log, only the flattened `lastValues` sticky cache), matches
   * `TelemetryProvider`'s own lifecycle, which attaches its store before
   * anything can possibly subscribe through it.
   *
   * Returns a detach function. Safe to attach more than one store to the
   * same client (each gets every message independently); a client is not
   * scoped to exactly one `TimelineStore`.
   */
  attachStore(store: TimelineStore): () => void {
    this.stores.add(store);
    // Unlike sample history, ownership verdicts DO backfill. There are a
    // handful of them, they are facts about the mod rather than about a moment,
    // and a store attached after one was reached would otherwise render a topic
    // as pending forever with the answer already sitting one object away.
    for (const topic of this.ownership?.unownedTopics() ?? []) {
      store.markTopicUnowned(topic);
    }
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
   * `transport.send` is called synchronously, the client always hands the
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
   * started: the command just waits. When a prediction IS
   * available, a loss timer is armed for `etaConfirm + LOSS_MARGIN`; if the
   * command is still `in-flight` when it fires, silence is inferred as
   * `lost` and the promise rejects. Any real settle (response or error)
   * cancels that timer first, so a confirmed/failed command can never later
   * flip to `lost`.
   *
   * `label` is an opaque, operator-facing description of the command
   * (e.g. the composed line text for a line-mode `kos.keystroke`) carried
   * straight through on the envelope: it plays no role in dispatch,
   * correlation, or loss inference. Defaults to `""` when omitted, matching
   * every pre-existing caller.
   *
   * `topic` is dispatch-time part/route addressing (e.g. `kos/<coreId>` for
   * a terminal-scoped command) carried straight through on the envelope,
   * same rollout shape as `label`, no role in dispatch, correlation, or loss
   * inference. Defaults to `""` (unscoped) when omitted.
   */
  /**
   * The authoritative one-way delay, in UT seconds, or `undefined` when nothing has
   * offered one. Set by whoever owns the `DelayAuthority` (see
   * `TelemetryProvider`'s delay-wiring effect, the single wiring point).
   */
  private delaySource: (() => number) | undefined;

  private warnedNoLossDeadline = false;

  /**
   * Hand the client the authoritative one-way delay so it can settle a dispatch that
   * is never answered. Returns a detach function; calling it restores the
   * transport-prediction fallback.
   *
   * Takes an ACCESSOR rather than a number because the delay changes as a craft moves
   * and a dispatch must be sized against the delay at ITS moment, not at wiring time.
   * `DelayAuthority.delaySeconds` is a bound arrow field with a stable identity for
   * exactly this hand-off.
   */
  setDelaySource(getOneWaySeconds: () => number): () => void {
    this.delaySource = getOneWaySeconds;
    return () => {
      if (this.delaySource === getOneWaySeconds) this.delaySource = undefined;
    };
  }

  /**
   * Say so, once, when a dispatch gets no loss deadline.
   *
   * Loud on purpose. The whole defect this replaced was a silent fallback to
   * `clock.now()`: no deadline, no timer, no complaint, and a queue that looked like
   * nothing was ever lost. A deployment with neither an authority nor a predicting
   * transport still cannot settle an unanswered promise, and that has to be audible
   * rather than inferred from an absence months later.
   */
  private warnNoLossDeadlineOnce(): void {
    if (this.warnedNoLossDeadline) return;
    this.warnedNoLossDeadline = true;
    console.warn(
      "[sitrep] no delay authority and no transport prediction: command promises " +
        "cannot be settled on silence, so an unanswered dispatch will hang. " +
        "Attach a DelayAuthority (TelemetryProvider does this) or implement " +
        "Transport.predictConfirmEta.",
    );
  }

  dispatch(
    command: string,
    args?: unknown,
    label?: string,
    topic?: string,
    vantage?: string,
  ): { requestId: string; result: Promise<unknown> } {
    const requestId = `c${this.nextRequestId++}`;
    // Where the round trip comes from, and why in THIS order.
    //
    // A transport that OWNS its delay model is asked first: `CourierTransport` drives
    // the courier's own engine and its prediction is the ground truth for that
    // deployment. Nothing else can know it.
    //
    // Otherwise the delay AUTHORITY answers. `comms.delay.oneWaySeconds` is the
    // server-enforced number that DEFINES the delay, and `DelayAuthority` already
    // holds it live (it subscribes on this very client), so the round trip is
    // `2 * oneWay` and this layer computes it without the transport knowing anything
    // about delay at all. That is the production path: `WebSocketTransport`
    // deliberately does not predict.
    //
    // The order matters because of a typed-absence trap. `DelayAuthority.delaySeconds`
    // fail-safes to 0 (see `readOneWaySeconds`), so "no sample has arrived" and "the
    // delay is genuinely zero" are the same value from here. Asking the authority
    // FIRST therefore let an un-fed 0 override a courier that knew the real answer,
    // which is exactly what three existing courier tests caught. Preferring an
    // explicit transport prediction avoids needing to tell those two cases apart.
    //
    // They are alternatives, never both: one source per deployment rather than two
    // competing ones. See `Transport.predictConfirmEta` for the rule a new transport
    // must follow.
    const predictedEta =
      this.transport.predictConfirmEta?.() ??
      (this.delaySource
        ? this.clock.now() + 2 * this.delaySource()
        : undefined);
    const etaConfirm = predictedEta ?? this.clock.now();
    if (predictedEta === undefined) this.warnNoLossDeadlineOnce();

    const result = new Promise<unknown>((resolve, reject) => {
      this.commands.set(requestId, {
        command,
        args,
        label: label ?? "",
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
      topic: topic ?? "",
      // Per-call vantage override (delay-UX): "" ⇒ the server uses the session
      // vantage; "meta" pins a program-meta command to instant dispatch.
      vantage: vantage ?? "",
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
    this.unsubscribeFromTransportStatus();
    this.unsubscribeFromUndelivered();
    this.unsubscribeFromLost();
    this.ownership?.dispose();

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
      reject(new CommandError(error.code, error.message));
    }

    this.subscribers.clear();
    this.lastValues.clear();
    this.storeListeners.clear();
    this.unownedListeners.clear();
    this.subscriberLabels.clear();
    this.commands.clear();
    this.stores.clear();
  }

  /**
   * Record the vantage an arriving frame was delayed from. See
   * {@link observedVantage} for why the meta vantage is not one, and why an
   * empty stamp (a transport with nothing to say about vantage) is not either.
   */
  private noteObservedVantage(vantage: string): void {
    if (!vantage || vantage === META_VANTAGE) return;
    if (vantage === this.observedVantageId) return;
    this.observedVantageId = vantage;
    for (const listener of this.observedVantageListeners) listener();
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === "command-response") {
      this.handleCommandResponse(message.requestId, message.result);
      return;
    }
    if (message.type === "error") {
      // An error carrying a TOPIC and no requestId is not a reply to any
      // command: it is a channel that was acked and then could not be put on
      // the wire. The command correlator below returns immediately on a
      // missing requestId, so before this branch the frame was discarded and
      // the author was left with the exact silence the mod had just gone to
      // the trouble of explaining. See `channel-error-warning.ts`.
      if (!message.requestId && message.topic) {
        /* `unknown-topic` is the mod refusing the subscribe, not a channel that
           was acked and then broke, so it belongs to the ownership verdict and
           NOT to `warnChannelError`, whose text says the opposite happened. */
        if (message.code === "unknown-topic") {
          this.ownership?.noteRefused(message.topic);
          return;
        }
        warnChannelError(
          this.channelErrorsWarned,
          message.topic,
          message.code,
          message.message,
        );
        return;
      }
      this.handleCommandError(message.requestId, message.code, message.message);
      return;
    }
    // The `subscribed` ack. Every event frame was dropped here until this
    // branch existed, which is why the mod's own answer to "does anything
    // publish this topic" reached nothing that could use it.
    if (message.type === "event") {
      if (message.name === "subscribed") this.ownership?.noteAck(message.topic);
      return;
    }
    if (message.type !== "stream-data") return;
    this.noteObservedVantage(message.meta.vantage);
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
    if (!pending) return;
    // No live resolve(): the command already settled, so a duplicate must not
    // clobber the terminal status already recorded. With ONE exception, which is
    // the whole of `found`: a command settled as `lost` was never decided, and a
    // reply proving it arrived after all is news rather than a duplicate.
    if (!pending.resolve) {
      if (pending.status.phase === "lost")
        this.handleFound(requestId, pending, result);
      return;
    }
    pending.cancelLossTimer?.();
    pending.cancelLossTimer = null;
    const resolve = pending.resolve;
    const reject = pending.reject;
    pending.resolve = null;
    pending.reject = null;

    // A well-formed refusal arrives on this channel, not as an `"error"`
    // message: the mod answers `CommandResult.Fail(code)` when the handler ran
    // and the game said no. Settling that as `confirmed` told the operator a
    // refused command had worked.
    const refusal = refusalOf(result);
    if (refusal !== null) {
      const { errorCode, breach, detail } = refusal;
      pending.status = {
        phase: "refused",
        requestId,
        errorCode,
        command: pending.command,
        args: pending.args,
        label: pending.label,
        breach,
        detail,
      };
      reject?.(
        new CommandError(
          COMMAND_REFUSED,
          // Names what was refused. The enum member alone reads identically for
          // every refusal of every command in the mod, so an operator cannot
          // tell which control said no.
          `command ${JSON.stringify(pending.command)} refused: ${
            CommandErrorCode[errorCode] ?? errorCode
          }`,
          errorCode,
          {
            command: pending.command,
            args: pending.args,
            label: pending.label,
            breach,
            detail,
          },
        ),
      );
      this.notifyStore();
      return;
    }

    pending.status = { phase: "confirmed", requestId, result };
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
    if (!pending) return;
    // Same exception as `handleCommandResponse`, and it is not a lesser case: an
    // `error` frame correlated to this requestId is proof the mod RECEIVED the
    // command, so the silence was ours. What it went on to say is that the
    // machinery broke over there, which is news of its own.
    if (!pending.reject) {
      if (pending.status.phase === "lost") {
        pending.status = {
          phase: "found",
          requestId,
          outcome: "errored",
          error: { code, message },
        };
        this.notifyStore();
      }
      return;
    }
    pending.cancelLossTimer?.();
    pending.cancelLossTimer = null;
    const reject = pending.reject;
    pending.status = { phase: "failed", requestId, error: { code, message } };
    pending.resolve = null;
    pending.reject = null;
    reject(new CommandError(code, message));
    this.notifyStore();
  }

  /**
   * A command that was called lost, answered after all.
   *
   * Reached only from the two reply handlers, and only for an entry whose status
   * is still `lost`: a second late reply finds the entry at `found` and is
   * ignored by the same phase check, so this can no more run twice than the
   * settle path it mirrors.
   *
   * The promise is deliberately left alone. It rejected as `E_LOST` when the
   * deadline passed and that was true at the time, so re-settling it is both
   * impossible and unwanted; `resolve`/`reject` are already `null` by the time
   * anything gets here.
   *
   * The refusal split is the same one `handleCommandResponse` makes below,
   * because a refusal that arrives late is still the game's verdict and still
   * carries the only actionable half of the news.
   */
  private handleFound(
    requestId: string,
    pending: PendingCommand,
    result: unknown,
  ): void {
    const refusal = refusalOf(result);
    pending.status =
      refusal === null
        ? { phase: "found", requestId, outcome: "ran", result }
        : {
            phase: "found",
            requestId,
            outcome: "refused",
            errorCode: refusal.errorCode,
            breach: refusal.breach,
            detail: refusal.detail,
          };
    this.notifyStore();
  }

  /**
   * The one place a command becomes `lost`, whichever of its two callers got
   * here first. A no-op if the command has already settled (or is unknown), the
   * timer is always cancelled on settle, but this guard covers the case where
   * cancellation and firing raced within the same clock-driven callback batch.
   *
   * - our own loss-inference timer reaching `etaConfirm + LOSS_MARGIN` with no
   *   response, which is the local case and the default reason
   * - a transport RELAYING someone else's verdict (`Transport.onLost`), which is
   *   how the host's loss reaches a station: the station's command is dispatched
   *   to the mod by the host, so the host's timer is the only one measuring that
   *   leg. A station arms its own off the relayed `comms.delay`, timing a
   *   different leg, so the two fire in either order and both must land here
   *
   * Terminal for the PROMISE and not for the entry. The correlation record stays
   * in `commands`, so a reply arriving after this (the transport re-sends what it
   * queued while the socket was down, and a reply can simply be slow) still finds
   * its way home and moves the status to `found`. Nothing here tries to stop the
   * command executing: `lost` is our ignorance, not the game's answer.
   */
  private handleLoss(
    requestId: string,
    reason = "signal-lost",
    message = "command lost: no confirmation received by predicted ETA",
  ): void {
    const pending = this.commands.get(requestId);
    if (!pending || pending.status.phase !== "in-flight") return;
    const reject = pending.reject;
    /*
     * A no-op when this IS the timer firing, and load-bearing when a relayed
     * loss beat our own deadline: the phase guard above would make the later
     * firing harmless, but the scheduled callback would still be holding a
     * command that is finished with.
     */
    pending.cancelLossTimer?.();
    pending.status = { phase: "lost", requestId, reason };
    pending.resolve = null;
    pending.reject = null;
    pending.cancelLossTimer = null;
    reject?.(new CommandError(COMMAND_LOST, message));
    this.notifyStore();
  }

  /**
   * A command the transport is never going to send, because it has stopped
   * trying (`Transport.onUndelivered`).
   *
   * Reaches two different states and answers both, which is why it is not a
   * branch of the reply handlers:
   *
   * - the dispatch is still awaiting an answer, because nothing ever armed a
   *   loss timer for it (no delay authority, no transport prediction) or the
   *   deadline has not come round. Its promise is settled here, `failed` with
   *   `E_UNDELIVERED`: `failed` because nothing was decided over there, and a
   *   retry is safe rather than doubling anything
   * - the loss timer already called it `lost` and rejected. That promise is
   *   spent and is deliberately left alone, exactly as `handleFound` leaves it;
   *   what moves is the STATUS, from "we do not know" to "it did not happen",
   *   which is the whole reason a stranded command cannot be answered on the
   *   error channel. `handleCommandError` reads an error correlated to a lost
   *   requestId as proof the mod HEARD us
   *
   * Any other phase is ignored. A confirmed, refused or found command was
   * answered by the far side and so plainly did leave; a second report for an
   * already-`undelivered` command changes nothing.
   */
  private handleUndelivered(requestId: string, reason: string): void {
    const pending = this.commands.get(requestId);
    if (!pending) return;
    const status: CommandStatus = { phase: "undelivered", requestId, reason };
    if (!pending.reject) {
      if (pending.status.phase !== "lost") return;
      pending.status = status;
      this.notifyStore();
      return;
    }
    pending.cancelLossTimer?.();
    pending.cancelLossTimer = null;
    const reject = pending.reject;
    pending.status = status;
    pending.resolve = null;
    pending.reject = null;
    reject(new CommandError(COMMAND_UNDELIVERED, reason));
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
