import type { ServerMessage } from "@gonogo/sitrep-sdk";
import type { CommandStatus } from "./lifecycle";
import type { Transport } from "./transport";

type Callback = (value: unknown) => void;
type StoreListener = () => void;

/**
 * One record per `subscribe()` call, not per callback identity — the same
 * callback reference can be passed to `subscribe` multiple times and each
 * call must ref-count independently (see `off()` in `subscribe`).
 */
interface Subscription {
  cb: Callback;
}

/** Bookkeeping for one in-flight (or resolved) command dispatch. */
interface PendingCommand {
  status: CommandStatus;
  resolve: (result: unknown) => void;
  reject: (error: { code: string; message: string }) => void;
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
  private readonly subscribers = new Map<string, Set<Subscription>>();
  private readonly lastValues = new Map<string, unknown>();
  private readonly storeListeners = new Set<StoreListener>();
  private readonly unsubscribeFromTransport: () => void;
  private readonly commands = new Map<string, PendingCommand>();
  private nextRequestId = 0;

  constructor(transport: Transport) {
    this.transport = transport;
    this.unsubscribeFromTransport = transport.onMessage((message) =>
      this.handleMessage(message),
    );
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
   */
  dispatch(
    command: string,
    args?: unknown,
  ): { requestId: string; result: Promise<unknown> } {
    const requestId = `c${this.nextRequestId++}`;
    const result = new Promise<unknown>((resolve, reject) => {
      this.commands.set(requestId, {
        status: { phase: "in-flight", requestId },
        resolve,
        reject,
      });
    });
    this.notifyStore();
    this.transport.send({
      type: "command-request",
      requestId,
      command,
      args,
      sentAt: 0,
    });
    return { requestId, result };
  }

  /** Current lifecycle status for a dispatched command, or `idle` if unknown. */
  getCommand(requestId: string): CommandStatus {
    return this.commands.get(requestId)?.status ?? { phase: "idle" };
  }

  /** Tear down the transport listener and clear all local state. */
  dispose(): void {
    this.unsubscribeFromTransport();
    this.subscribers.clear();
    this.lastValues.clear();
    this.storeListeners.clear();
    this.commands.clear();
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
    this.notifyStore();
  }

  private handleCommandResponse(requestId: string, result: unknown): void {
    const pending = this.commands.get(requestId);
    if (!pending) return;
    pending.status = { phase: "confirmed", requestId, result };
    pending.resolve(result);
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
    const error = { code, message };
    pending.status = { phase: "failed", requestId, error };
    pending.reject(error);
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
