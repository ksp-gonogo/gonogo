/**
 * Adapts a `Courier` (the reference delay engine) to the `Transport`
 * interface consumed by `@ksp-gonogo/sitrep-client`'s `TelemetryClient`. This is
 * what lets the unchanged M2 client receive DELAYED streams and DELAYED
 * command round-trips: from the client's point of view it's just talking to
 * a `Transport`, same as `StubTransport` in M2 tests.
 *
 * `Transport`/`TransportStatus` are re-declared structurally here rather
 * than imported from `@ksp-gonogo/sitrep-client` — `sitrep-server` must never
 * take a runtime dependency on `sitrep-client`. TypeScript's structural
 * typing means a `CourierTransport` still satisfies the real `Transport`
 * interface at the client's constructor call site, because the message
 * types (`ClientMessage`/`ServerMessage`) are the same nominal types,
 * imported by both packages from the shared `@ksp-gonogo/sitrep-sdk`.
 *
 * One `CourierTransport` represents one connection: a single active
 * `node`/vessel observed from a single `vantage`, per the single-active-
 * vessel model for M3. `predictConfirmEta()` is what makes client-side loss
 * inference (Task 8) possible without the client ever computing delay
 * itself: it hands back `clock.now() + courier.roundTripEta(node, vantage)`,
 * the same round-trip model `dispatchCommand` uses internally, so the
 * client's loss timer and the courier's actual confirm-delivery schedule
 * agree by construction.
 */
import type { ClientMessage, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import type { Clock } from "./clock";
import type { Courier } from "./courier";

/** Connection status of a Transport's underlying pipe. */
export type TransportStatus =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

/** Structural mirror of `@ksp-gonogo/sitrep-client`'s `Transport` interface. */
export interface Transport {
  readonly status: TransportStatus;
  send(message: ClientMessage): void;
  onMessage(listener: (message: ServerMessage) => void): () => void;
  onStatusChange(listener: (status: TransportStatus) => void): () => void;
  predictConfirmEta?(): number | undefined;
}

export class CourierTransport implements Transport {
  readonly status: TransportStatus = "connected";

  private readonly courier: Courier;
  private readonly node: string;
  private readonly vantage: string;
  // Used by `predictConfirmEta()` (Task 8) to anchor the prediction to "now"
  // — the courier already owns its own Clock for internal scheduling, this
  // is the same clock instance, just read directly here too.
  private readonly clock: Clock;

  private readonly messageListeners = new Set<
    (message: ServerMessage) => void
  >();
  private readonly statusListeners = new Set<
    (status: TransportStatus) => void
  >();
  // topic -> unsubscribe fn returned by courier.subscribeStream, so a later
  // "unsubscribe" message can tear down the right stream.
  private readonly activeSubscriptions = new Map<string, () => void>();

  constructor(deps: {
    courier: Courier;
    node: string;
    vantage: string;
    clock: Clock;
  }) {
    this.courier = deps.courier;
    this.node = deps.node;
    this.vantage = deps.vantage;
    this.clock = deps.clock;
  }

  send(message: ClientMessage): void {
    switch (message.type) {
      case "subscribe": {
        if (this.activeSubscriptions.has(message.topic)) {
          return;
        }
        const off = this.courier.subscribeStream(
          this.node,
          message.topic,
          this.vantage,
          (streamData) => this.emit(streamData),
        );
        this.activeSubscriptions.set(message.topic, off);
        return;
      }
      case "unsubscribe": {
        const off = this.activeSubscriptions.get(message.topic);
        if (off) {
          off();
          this.activeSubscriptions.delete(message.topic);
        }
        return;
      }
      case "command-request": {
        this.courier.dispatchCommand(
          this.node,
          message.requestId,
          message.command,
          message.args,
          this.vantage,
          (response) => this.emit(response),
        );
        return;
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
   * Predicted absolute UT a command dispatched right now would be confirmed
   * by: "now" plus the courier's round-trip model for this (node, vantage)
   * pair. Consumed purely by the client's loss-inference timer — this
   * transport never itself decides what counts as "too late".
   */
  predictConfirmEta(): number {
    return (
      this.clock.now() + this.courier.roundTripEta(this.node, this.vantage)
    );
  }

  private emit(message: ServerMessage): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }
}
