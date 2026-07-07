import type { EventMsg, ServerMessage, StreamData } from "@gonogo/sitrep-sdk";
import type { Clock } from "./clock";
import type { Transport, TransportStatus } from "./transport";

/**
 * The subset of the real `reference-wire-fixture.json` shape (see
 * `reference-wire-fixture.test.ts`'s own `WireFixture` interface, the C#
 * `WireFixtureGeneratorTests` producer) this transport actually needs.
 * Structurally compatible with the full fixture — a caller can `JSON.parse`
 * the real file and pass it straight in; extra fields (`generatedAtUtc`,
 * `recordingFile`, `frameCount`, `epochsSeen`, ...) are simply ignored.
 *
 * `frames` are each the EXACT raw wire text of one captured frame (a
 * `JSON.stringify`'d `ServerMessage` — `stream-data` or `event`, per M3
 * Wave 0's spec), same convention as the C# generator and
 * `reference-wire-fixture.test.ts`'s own driver loop.
 */
export interface ReplayFixture {
  /**
   * The topics this recording session subscribed to — the transport's own
   * `carriedChannels` declaration (M3 Wave 0 carried-channels gate,
   * `./carried-channels.ts`) is built straight from this list. Optional:
   * when omitted, `ReplayTransport` derives the same set itself from the
   * distinct `topic` fields actually present across `frames`.
   */
  subscribedTopics?: readonly string[];
  frames: readonly string[];
}

export interface ReplayTransportOptions {
  /**
   * Drives WHEN each frame is delivered. Never real wall time — this is the
   * whole point of `ReplayTransport` as the no-KSP iteration engine
   * (`m3-migration-plan.md` §4-transport): a test (or a headless replay
   * screen) injects a deterministic clock so "replay this recorded flight"
   * never races a real timer. `schedule`'s time domain must match the
   * fixture's own `meta.deliveredAt` units (UT seconds, same convention as
   * `TelemetryClient`'s own `Clock` — see `./clock.ts`'s domain note).
   */
  clock: Pick<Clock, "now" | "schedule">;
  /**
   * When `true`, once every frame has been delivered the replay restarts
   * from the first frame (re-anchored to the clock's `now()` at that
   * moment) instead of going quiet forever. Default `false` — a single
   * pass, matching the recorded session's own length.
   */
  loop?: boolean;
}

interface ScheduledFrame {
  /** Offset (seconds) from the FIRST frame's `deliveredAt` — what actually drives scheduling, never the fixture's raw absolute UT (which belongs to the ORIGINAL recording session, not this replay's clock). */
  offsetFromStart: number;
  message: ServerMessage;
}

/** `true` for the two frame types a captured wire recording ever carries — `command-response`/`error` frames never appear in a `ChannelEngine` capture (`m3-migration-plan.md`'s own description: "StreamData/EventMsg frames"). */
function isDataOrEventFrame(
  message: ServerMessage,
): message is StreamData<unknown> | EventMsg {
  return message.type === "stream-data" || message.type === "event";
}

/**
 * A `Transport` that replays a captured wire recording (the
 * `reference-wire-fixture.json` shape) into a `TelemetryClient`, honoring
 * each frame's own `meta.deliveredAt` cadence under an INJECTED clock — the
 * M3 Wave 0 no-KSP iteration engine (`m3-migration-plan.md` §4-transport):
 * "lets the whole dashboard run off the recording headlessly... with no KSP
 * restarts and no deployed mod — the recording is the iteration engine."
 *
 * Promotes the test-only `FixtureTransport` pattern
 * (`reference-wire-fixture.test.ts`) to a reusable, production-shaped class:
 * - **Delivery order** always follows `meta.deliveredAt` ascending, even if
 *   `fixture.frames` itself isn't sorted that way (a defensive sort at
 *   construction — never trust caller ordering for the one invariant this
 *   whole class exists to honor).
 * - **Timing** is anchored, not absolute: the first frame's `deliveredAt` is
 *   offset zero, and every later frame is scheduled at
 *   `clock.now() (at construction) + (frame.deliveredAt - firstDeliveredAt)`
 *   — so a fixture recorded against an arbitrary in-game UT replays correctly
 *   against a test clock that starts at 0, or a production clock that starts
 *   at "now".
 * - **`carriedChannels`** (M3 Wave 0 carried-channels gate,
 *   `./carried-channels.ts`) is declared statically at construction as
 *   EXACTLY the fixture's topic set — `TelemetryProvider` reads this
 *   straight through `client.declaredChannels`, so a screen mounted with a
 *   `ReplayTransport` streams every topic the recording carries with ZERO
 *   extra promotion wiring.
 *
 * `send()` is a no-op, same rationale as `FixtureTransport`: the fixture is
 * already scoped to exactly the topics the original recording session
 * subscribed to, so there is no real subscribe/unsubscribe bookkeeping for
 * this transport to honor.
 */
export class ReplayTransport implements Transport {
  readonly status: TransportStatus = "connected";
  readonly carriedChannels: readonly string[];

  private readonly clock: Pick<Clock, "now" | "schedule">;
  private readonly loop: boolean;
  private readonly schedule: ScheduledFrame[];
  private readonly messageListeners = new Set<
    (message: ServerMessage) => void
  >();
  private readonly statusListeners = new Set<
    (status: TransportStatus) => void
  >();
  private cancelHandles: (() => void)[] = [];

  constructor(fixture: ReplayFixture, options: ReplayTransportOptions) {
    this.clock = options.clock;
    this.loop = options.loop ?? false;

    const parsed = fixture.frames
      .map((raw) => JSON.parse(raw) as ServerMessage)
      .filter(isDataOrEventFrame)
      .sort((a, b) => a.meta.deliveredAt - b.meta.deliveredAt);

    const firstDeliveredAt = parsed.length > 0 ? parsed[0].meta.deliveredAt : 0;
    this.schedule = parsed.map((message) => ({
      offsetFromStart: message.meta.deliveredAt - firstDeliveredAt,
      message,
    }));

    this.carriedChannels = fixture.subscribedTopics ?? [
      ...new Set(parsed.map((message) => message.topic)),
    ];

    this.armFrom(this.clock.now());
  }

  send(): void {
    // No-op — see class doc comment.
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(listener: (status: TransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Cancels every still-pending scheduled delivery. Idempotent; safe to call even if the replay already finished on its own. */
  stop(): void {
    for (const cancel of this.cancelHandles) cancel();
    this.cancelHandles = [];
  }

  private armFrom(anchorUt: number): void {
    this.cancelHandles = this.schedule.map(({ offsetFromStart, message }) =>
      this.clock.schedule(anchorUt + offsetFromStart, () =>
        this.deliver(message),
      ),
    );

    if (this.loop && this.schedule.length > 0) {
      const totalSpan = this.schedule[this.schedule.length - 1].offsetFromStart;
      const cancelReloop = this.clock.schedule(anchorUt + totalSpan, () =>
        this.armFrom(this.clock.now()),
      );
      this.cancelHandles.push(cancelReloop);
    }
  }

  private deliver(message: ServerMessage): void {
    for (const listener of this.messageListeners) {
      try {
        listener(message);
      } catch (error) {
        // A throwing listener must not prevent sibling listeners (or later
        // scheduled frames) from being delivered — same isolation contract
        // as `StubTransport.deliver`.
        console.error("ReplayTransport: message listener threw", error);
      }
    }
  }
}
