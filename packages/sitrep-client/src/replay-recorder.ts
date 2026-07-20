import { getAllKnownTopicIds } from "@ksp-gonogo/sitrep-sdk";
import type { TelemetryClient } from "./client";
import type { ReplayFixture } from "./replay-transport";

export interface StreamRecorderOptions {
  /**
   * Full-archive opt-in. When `true`, `start()` additionally subscribes to
   * EVERY topic `getAllKnownTopicIds()` reports (`@ksp-gonogo/sitrep-sdk` — the
   * SDK's own topics plus every bare-primitive Uplink topic a loaded client has
   * registered) so the
   * resulting fixture can replay any widget's history, not just whatever the
   * dashboard happened to have mounted while recording. This trades away the
   * carried-channels subscription system's whole efficiency point (the mod
   * only produces what's watched) for completeness — costs more mod-side
   * produce load and a bigger recording. Default `false`: subscription-scoped,
   * the cheap default — the recording only ever holds the topics the
   * dashboard already carried, nothing extra.
   */
  recordAllTopics?: boolean;
}

/**
 * Captures a `TelemetryClient`'s raw wire frames into a `ReplayFixture` —
 * the same `{ subscribedTopics, frames }` shape `ReplayTransport` consumes,
 * so a user recording and a test fixture are structurally identical.
 *
 * Taps `client.onRawMessage` (verbatim `stream-data`/`event` frames, in
 * arrival order) rather than `client.subscribe` — `subscribe` only hands
 * back the flattened last-value view and never delivers `event` frames at
 * all (see `onRawMessage`'s own doc comment), neither of which round-trips
 * through `ReplayTransport` correctly.
 *
 * **Subscription-scoped by default**: with `recordAllTopics` off, `start()`
 * registers no subscriptions of its own — it only records whatever
 * `stream-data`/`event` frames already flow because something ELSE (a
 * mounted widget, another recorder) is subscribed. A recording therefore
 * holds exactly the topics the dashboard had open; replaying a widget that
 * was never mounted while recording shows nothing. That's the accepted,
 * cheap default (see `StreamRecorderOptions.recordAllTopics`'s doc for the
 * opt-in alternative).
 *
 * Idle (never `start()`ed, or after `stop()`) costs nothing: no listener is
 * registered on the client until `start()` runs.
 */
export class StreamRecorder {
  private readonly client: TelemetryClient;
  private readonly recordAllTopics: boolean;
  private frames: string[] = [];
  private readonly observedTopics = new Set<string>();
  private detachRawTap: (() => void) | undefined;
  private readonly extraSubscriptions: Array<() => void> = [];
  private latestValidAt = 0;
  private recordingFlag = false;

  constructor(client: TelemetryClient, options: StreamRecorderOptions = {}) {
    this.client = client;
    this.recordAllTopics = options.recordAllTopics ?? false;
  }

  /** Whether `start()` has run without a matching `stop()` yet. */
  get recording(): boolean {
    return this.recordingFlag;
  }

  /** Frames captured so far in the current (or just-finished) session. */
  get frameCount(): number {
    return this.frames.length;
  }

  /** The highest `meta.validAt` observed so far — the recording's "now", in UT seconds. `0` before any frame lands. */
  get latestUt(): number {
    return this.latestValidAt;
  }

  /**
   * Begin capturing. No-op if already recording. Clears any frames left over
   * from a previous session — call `stop()` first to retrieve them.
   */
  start(): void {
    if (this.recordingFlag) return;
    this.recordingFlag = true;
    this.frames = [];
    this.observedTopics.clear();
    this.latestValidAt = 0;

    this.detachRawTap = this.client.onRawMessage((message) => {
      if (message.type !== "stream-data" && message.type !== "event") return;
      this.observedTopics.add(message.topic);
      this.frames.push(JSON.stringify(message));
      if (
        message.type === "stream-data" &&
        message.meta.validAt > this.latestValidAt
      ) {
        this.latestValidAt = message.meta.validAt;
      }
    });

    if (this.recordAllTopics) {
      // The full live set — the SDK's own Topics PLUS every bare-primitive Uplink
      // Topic registered by a loaded client. Those are no longer static members of
      // `TOPIC_IDS`, so iterating the runtime registry keeps the full-archive
      // recording complete.
      for (const topic of getAllKnownTopicIds()) {
        this.extraSubscriptions.push(this.client.subscribe(topic, () => {}));
      }
    }
  }

  /**
   * Stop capturing and return the `ReplayFixture` built from this session.
   * Idempotent-safe to call while not recording (returns whatever frames are
   * currently buffered, tearing down nothing extra). `subscribedTopics` is
   * the set of topics actually OBSERVED — never a static declaration — so it
   * stays accurate whether or not `recordAllTopics` forced extra subscriptions.
   */
  stop(): ReplayFixture {
    this.recordingFlag = false;
    this.detachRawTap?.();
    this.detachRawTap = undefined;
    for (const unsubscribe of this.extraSubscriptions) unsubscribe();
    this.extraSubscriptions.length = 0;

    return {
      subscribedTopics: [...this.observedTopics],
      frames: this.frames,
    };
  }
}
