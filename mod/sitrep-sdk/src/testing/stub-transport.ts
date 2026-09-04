import { type Meta, Quality, Staleness } from "../__generated__/contract";
import type { Transport, TransportStatus } from "../api/transport";
import type { ClientMessage, ServerMessage } from "../envelope";
import type { TopicId } from "../topics";
import { wrapTopicPayload, wrapTypePayload } from "../wrap-units";

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

/**
 * Re-exported from `../wrap-units`, where it moved when it became the declared
 * input type of the wrap functions themselves. Kept here because every fixture
 * in the tree imports it from this module.
 */
export type { WireOf } from "../wrap-units";

// Re-exporting does not bind the name locally, and `wrapWire` below uses it.
import type { WireOf } from "../wrap-units";

/**
 * `wrapTypePayload` under the name the fixtures already call it by.
 *
 * It used to bridge a real gap: the runtime function was declared
 * `<T>(name: string, payload: T): T`, which claimed to hand back what it was
 * given while actually wrapping bare numbers into `Value`s, so every fixture
 * writing the wire had to double-cast across the lie and lost the field-name
 * and nesting check that was the reason to annotate at all. The signature now
 * states the conversion it performs, so this is a plain alias.
 *
 * Kept rather than deleted because ten fixture files call it, and a rename
 * would churn them to say the same thing.
 */
export function wrapWire<P>(typeName: string, wire: WireOf<P>): P {
  return wrapTypePayload<P>(typeName, wire);
}

/**
 * The observation a reckoner is always handed.
 *
 * `ReckonerFor` types its point as `TimelinePoint<T>`, whose `payload` is
 * `T | null`, but `readingFrom` returns the `absent` arm on a tombstone before
 * it ever reaches the reckoner, so the null is unreachable. Reckoners written
 * against the honest reading of that type end up adding a fallback for a case
 * the store cannot produce, and a fallback is a value: it would be modelled
 * forward and rendered as though someone had observed it.
 *
 * So this asserts the invariant rather than papering over it. If the store ever
 * does hand a reckoner a tombstone, the throw names it.
 *
 * The parameter is structural rather than `TimelinePoint<T>` on purpose, and
 * not for elegance: importing that type into this file put `../timeline` into
 * the `testing` entry point's bundled declarations, and that alone produced 45
 * `implicitly has an 'any' type` errors across `@ksp-gonogo/components`, on
 * `styled-components` props with nothing to do with either module. The function
 * reads one field, so it asks for one field.
 */
export function observedPayload<T>(point: { readonly payload: T | null }): T {
  if (point.payload === null) {
    throw new Error(
      "a reckoner was handed a tombstone: readingFrom should have returned the absent arm before calling one",
    );
  }
  return point.payload;
}

type CommandHandler = (command: string, args: unknown) => unknown;

/** One recorded `command-request` envelope, verbatim: see `StubTransport.sentCommands`. */
export interface SentCommand {
  requestId: string;
  command: string;
  args: unknown;
  label: string;
  topic: string;
  /** Per-call vantage override, `""` when the dispatch omitted it. */
  vantage: string;
}

/**
 * In-memory, scriptable `Transport` used to fake a telemetry source in tests.
 *
 * `emit`/`setCommandHandler` are test-only helpers that don't exist on the
 * `Transport` interface itself: they let a test drive the stub as if it
 * were a real server on the other end of the pipe.
 */
export class StubTransport implements Transport {
  readonly status: TransportStatus = "connected";
  /**
   * Off unless a test asks for it, matching the interface's own default and for
   * the same reason: a stub never acks unless the test makes it, so opting in by
   * default would mature every topic in every test into `unowned`.
   *
   * A test that opts in is taking on the job of acking, via
   * {@link StubTransport.ackSubscribe}.
   */
  readonly decidesTopicOwnership: boolean;

  constructor(options: { decidesTopicOwnership?: boolean } = {}) {
    this.decidesTopicOwnership = options.decidesTopicOwnership ?? false;
  }

  private readonly messageListeners = new Set<
    (message: ServerMessage) => void
  >();
  private readonly statusListeners = new Set<
    (status: TransportStatus) => void
  >();
  private readonly subscribedTopics = new Set<string>();
  private commandHandler: CommandHandler | undefined;
  /** See `holdCommands`. */
  private holdingCommands = false;
  private readonly heldCommands: (() => void)[] = [];

  /**
   * Every `command-request` envelope this transport has been asked to send,
   * verbatim, in send order: a test-only introspection log independent of
   * `commandHandler`. Exists so a test can assert on envelope fields
   * `CommandHandler`'s 2-arg `(command, args)` shape doesn't see (e.g.
   * `label`) WITHOUT widening `CommandHandler` itself: a prior attempt at
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
          vantage: message.vantage ?? "",
        });
        // Answer on a later microtask, not inline within this `send()` call.
        // Even at zero simulated latency, a command response must not
        // settle synchronously in the same call stack as the request, that
        // would let it race ahead of the caller's own `dispatch()` return,
        // skipping the observable `in-flight` phase. A real transport never
        // resolves in the same tick as the send, so the stub shouldn't either.
        const answer = () => {
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
        };
        if (this.holdingCommands) this.heldCommands.push(answer);
        else queueMicrotask(answer);
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
  /**
   * Emit a stream frame, wire-shaped.
   *
   * `payload` is written the way the mod sends it: plain numbers, no units.
   * They are wrapped into `Value`s on the way out, because that is what
   * `parseServerMessage` does to a real frame, and a fixture that skipped it
   * would hand widgets a shape production never produces.
   *
   * Cloned first. The wrap mutates what it is given, which is right for the
   * object `JSON.parse` just produced and wrong for a test fixture: a shared
   * one would be rewritten under the next test, and a frozen one threw. The
   * clone is what makes `emit` behave like a wire frame from the caller's
   * side as well as the listener's.
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
      payload: wrapTopicPayload(topic as TopicId, structuredClone(payload)),
      meta: makeMeta({ validAt: 0, deliveredAt: 0, ...metaOverrides }),
    });
  }

  /** Test helper: install the handler that answers command-request messages. */
  setCommandHandler(handler: CommandHandler): void {
    this.commandHandler = handler;
  }

  /**
   * Test helper: stop answering commands, and hold every request sent from now
   * on until {@link answerHeldCommands}.
   *
   * The in-flight window is what signal delay MAKES OF a command, and it is the
   * thing a control's pending state exists to show. Without this the stub
   * answers on the next microtask, which `userEvent.click` flushes before it
   * returns, so a test can watch a control go from rest to settled and never see
   * the phase in between: the state it was written to prove is the one it cannot
   * observe. Holding is what a travelling command actually looks like.
   */
  holdCommands(): void {
    this.holdingCommands = true;
  }

  /**
   * Test helper: answer everything held, in send order, and resume answering
   * normally.
   */
  answerHeldCommands(): void {
    this.holdingCommands = false;
    const held = this.heldCommands.splice(0, this.heldCommands.length);
    for (const answer of held) answer();
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
  /**
   * Test helper: answer a subscribe the way the mod does, with the `subscribed`
   * ack `ProcessSubscribe` publishes on the reliable lane. NOT sending one is
   * the interesting case, since that silence is what makes a topic unowned.
   */
  ackSubscribe(topic: string): void {
    this.emitRaw({
      type: "event",
      topic,
      name: "subscribed",
      meta: makeMeta(),
    });
  }

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
