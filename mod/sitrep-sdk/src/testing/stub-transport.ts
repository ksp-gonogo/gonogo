import { type Meta, Quality, Staleness } from "../__generated__/contract";
import { FaultCode } from "../__generated__/error-codes";
import type { Transport, TransportStatus } from "../api/transport";
import type { ClientMessage, ServerMessage } from "../envelope";
import type { TopicId } from "../topics";
import { wrapTopicPayload, wrapTypePayload } from "../wrap-units";

/**
 * A valid, repeatable `Meta` for test data, with `overrides` applied.
 *
 * @category Stream fixture
 */
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
 * Turns a payload as the mod sends it into the typed payload, with every number
 * that has a declared unit wrapped in a `Value`.
 *
 * @category Stream fixture
 */
export function wrapWire<Payload>(
  typeName: string,
  wire: WireOf<Payload>,
): Payload {
  return wrapTypePayload<Payload>(typeName, wire);
}

/**
 * The payload of the point a reckoner is handed. A reckoner is never handed a
 * null payload, so this returns it without the `null` its type allows, and
 * throws if one ever arrives.
 *
 * @category Stream fixture
 */
export function observedPayload<Payload>(point: {
  readonly payload: Payload | null;
}): Payload {
  if (point.payload === null) {
    throw new Error(
      "a reckoner was handed a tombstone: readingFrom should have returned the absent arm before calling one",
    );
  }
  return point.payload;
}

type CommandHandler = (command: string, args: unknown) => unknown;

/**
 * One command a {@link StubTransport} was sent, as it was sent. See
 * `StubTransport.sentCommands`.
 *
 * @category Stream fixture
 */
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
 * A {@link Transport} held in memory, for faking the mod in tests. `emit` and
 * `setCommandHandler` drive it as the mod would.
 *
 * @category Stream fixture
 */
export class StubTransport implements Transport {
  readonly status: TransportStatus = "connected";
  /**
   * Off unless the test turns it on. A test that turns it on must answer each
   * subscribe itself, with {@link StubTransport.ackSubscribe}; otherwise every
   * Topic would be marked unowned.
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
   * Every command this transport was asked to send, as it was sent, in order.
   * Use it to check fields of a command, such as `label`, that a command
   * handler set with `setCommandHandler` does not receive.
   */
  readonly sentCommands: SentCommand[] = [];

  /** Every group this transport was asked to send, with the request id of each member in order. Its members are also in {@link sentCommands}. */
  readonly sentGroups: { groupId: string; requestIds: string[] }[] = [];

  send(message: ClientMessage): void {
    switch (message.type) {
      case "subscribe":
        this.subscribedTopics.add(message.topic);
        break;
      case "unsubscribe":
        this.subscribedTopics.delete(message.topic);
        break;
      case "command-request":
        this.answerCommand(message);
        break;
      case "command-group":
        this.sentGroups.push({
          groupId: message.groupId,
          requestIds: message.members.map((member) => member.requestId),
        });
        for (const member of message.members) this.answerCommand(member);
        break;
    }
  }

  private answerCommand(
    message: Extract<ClientMessage, { type: "command-request" }>,
  ): void {
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
        /* A handler may throw an `Error` or a plain refusal bag, and both
           carry the two fields the error frame needs. */
        const raw: unknown = error;
        const named = typeof raw === "object" && raw !== null ? raw : undefined;
        const thrownCode: unknown = named
          ? Reflect.get(named, "code")
          : undefined;
        const thrownMessage: unknown = named
          ? Reflect.get(named, "message")
          : undefined;
        const code =
          typeof thrownCode === "string"
            ? (thrownCode as FaultCode)
            : FaultCode.CommandUnavailable;
        const errMessage =
          typeof thrownMessage === "string" ? thrownMessage : String(raw);
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
   * Sends one sample of `topic`, delivered only while something has
   * subscribed to it, as the mod's are. Write `payload` the way the mod sends
   * it, with plain numbers: each number with a declared unit arrives wrapped
   * in a `Value`, as a real frame does. `payload` is copied first, so a
   * shared or frozen fixture is safe to pass. `metaOverrides` sets fields of
   * the sample's `Meta`, such as its quality or `validAt`. `emitRaw` delivers
   * whether or not anything has subscribed.
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
   * Stops answering commands: every command sent from now on waits until
   * {@link StubTransport.answerHeldCommands}. Use it to see a control while its
   * command is on its way, which otherwise passes before a click returns.
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
