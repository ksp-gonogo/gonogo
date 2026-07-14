import type {
  ClientMessage,
  Meta,
  ServerMessage,
} from "@ksp-gonogo/sitrep-sdk";
import { Quality, Staleness } from "@ksp-gonogo/sitrep-sdk";
import type { Transport, TransportStatus } from "./transport";

/** Builds a valid, deterministic `Meta` for stubbed/test data. */
export function makeMeta(overrides: Partial<Meta> = {}): Meta {
  return {
    source: "stub",
    validAt: 0,
    seq: 0,
    deliveredAt: 0,
    vantage: "stub",
    quality: Quality.OnRails,
    active: false,
    staleness: Staleness.Fresh,
    timelineEpoch: 0,
    ...overrides,
  };
}

type CommandHandler = (command: string, args: unknown) => unknown;

/** One recorded `command-request` envelope, verbatim — see `StubTransport.sentCommands`. */
export interface SentCommand {
  requestId: string;
  command: string;
  args: unknown;
  label: string;
  topic: string;
}

/**
 * In-memory, scriptable `Transport` used to fake a telemetry source in tests.
 *
 * `emit`/`setCommandHandler` are test-only helpers that don't exist on the
 * `Transport` interface itself — they let a test drive the stub as if it
 * were a real server on the other end of the pipe.
 */
export class StubTransport implements Transport {
  readonly status: TransportStatus = "connected";

  private readonly messageListeners = new Set<
    (message: ServerMessage) => void
  >();
  private readonly statusListeners = new Set<
    (status: TransportStatus) => void
  >();
  private readonly subscribedTopics = new Set<string>();
  private commandHandler: CommandHandler | undefined;

  /**
   * Every `command-request` envelope this transport has been asked to send,
   * verbatim, in send order — a test-only introspection log independent of
   * `commandHandler`. Exists so a test can assert on envelope fields
   * `CommandHandler`'s 2-arg `(command, args)` shape doesn't see (e.g.
   * `label`) WITHOUT widening `CommandHandler` itself — a prior attempt at
   * that broke every pre-existing `toHaveBeenCalledWith(command, args)`
   * exact-arity assertion built on `setCommandHandler(vi.fn())` across the
   * `components` package. Keep this the ONE place a new envelope field gets
   * surfaced to tests.
   */
  readonly sentCommands: SentCommand[] = [];

  send(message: ClientMessage): void {
    switch (message.type) {
      case "subscribe":
        this.subscribedTopics.add(message.topic);
        break;
      case "unsubscribe":
        this.subscribedTopics.delete(message.topic);
        break;
      case "command-request": {
        this.sentCommands.push({
          requestId: message.requestId,
          command: message.command,
          args: message.args,
          label: message.label,
          topic: message.topic,
        });
        // Answer on a later microtask, not inline within this `send()` call.
        // Even at zero simulated latency, a command response must not
        // settle synchronously in the same call stack as the request — that
        // would let it race ahead of the caller's own `dispatch()` return,
        // skipping the observable `in-flight` phase. A real transport never
        // resolves in the same tick as the send, so the stub shouldn't either.
        queueMicrotask(() => {
          try {
            const result = this.commandHandler?.(message.command, message.args);
            this.deliver({
              type: "command-response",
              requestId: message.requestId,
              result,
              meta: makeMeta(),
            });
          } catch (error) {
            const { code, message: errMessage } = error as {
              code: string;
              message: string;
            };
            this.deliver({
              type: "error",
              requestId: message.requestId,
              code,
              message: errMessage,
            });
          }
        });
        break;
      }
    }
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(listener: (status: TransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * Test helper: fake an inbound stream-data sample. Only delivered if the
   * topic is subscribed. `metaOverrides` lets a test control quality/source/
   * validAt/etc. (e.g. to feed a derived channel's OnRails vs. Loaded basis)
   * without dropping to `emitRaw`, which bypasses the subscription-gating
   * this method deliberately keeps (the realistic case for proving
   * ref-counted subscribe actually happened).
   */
  emit(
    topic: string,
    payload: unknown,
    metaOverrides: Partial<Meta> = {},
  ): void {
    if (!this.subscribedTopics.has(topic)) return;
    this.deliver({
      type: "stream-data",
      topic,
      payload,
      meta: makeMeta({ validAt: 0, deliveredAt: 0, ...metaOverrides }),
    });
  }

  /** Test helper: install the handler that answers command-request messages. */
  setCommandHandler(handler: CommandHandler): void {
    this.commandHandler = handler;
  }

  /** Test helper: whether `topic` currently has an active `subscribe` on this transport. */
  isSubscribed(topic: string): boolean {
    return this.subscribedTopics.has(topic);
  }

  /**
   * Test helper: deliver an arbitrary raw `ServerMessage` straight to
   * listeners, bypassing topic-subscription gating. Useful for simulating
   * things a real transport can do that `emit`/`setCommandHandler` can't
   * script directly, e.g. a duplicate or late `command-response` arriving
   * for a `requestId` that already settled.
   */
  emitRaw(message: ServerMessage): void {
    this.deliver(message);
  }

  private deliver(message: ServerMessage): void {
    for (const listener of this.messageListeners) {
      try {
        listener(message);
      } catch (error) {
        // A throwing listener must not prevent sibling listeners from
        // receiving the message. TODO: route through the shared logger once
        // one exists for this package.
        console.error("StubTransport: message listener threw", error);
      }
    }
  }
}
