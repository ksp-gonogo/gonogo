import type { ServerMessage } from "../envelope";
import type { MissionMeta } from "../flight/types";
import { TelemetryClient } from "./client";
import type { Clock } from "./clock";
import { PRODUCTION_DERIVED_CHANNELS } from "./context";
import { type ReplayFixture, ReplayTransport } from "./replay-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * `Clock` that runs `rate`x real wall-clock speed, anchored at construction
 * (`now()` starts at 0): `ReplayTransport` computes every frame's fire time
 * relative to that anchor, so this is all it needs to honor the fixture's
 * own `deliveredAt` cadence at an adjustable playback speed. `rate` is
 * intentionally not mutable mid-flight: it is constructor-only, and changing
 * it means rebuilding the session; see `ReplaySessionController.setRate`.
 */
class ScaledRealTimeClock implements Pick<Clock, "now" | "schedule"> {
  private readonly anchorWallMs: number;

  constructor(private readonly rate: number) {
    this.anchorWallMs = performance.now();
  }

  now(): number {
    return ((performance.now() - this.anchorWallMs) / 1000) * this.rate;
  }

  schedule(atUt: number, fn: () => void): () => void {
    const delayMs = Math.max(0, ((atUt - this.now()) / this.rate) * 1000);
    const id = setTimeout(fn, delayMs);
    return () => clearTimeout(id);
  }
}

type DataOrEventMessage = Extract<
  ServerMessage,
  { type: "stream-data" | "event" }
>;

function isDataOrEventFrame(message: unknown): message is DataOrEventMessage {
  if (typeof message !== "object" || message === null) return false;
  const type: unknown = Reflect.get(message, "type");
  return type === "stream-data" || type === "event";
}

/**
 * Builds a synthetic fixture anchored at `targetDeliveredAt`: for every
 * topic, keeps only its latest frame at-or-before the target (a "keyframe
 * snapshot" of everything known as of that instant), plus
 * every frame strictly after the target unchanged. The snapshot frames'
 * `meta.deliveredAt` is rewritten to `targetDeliveredAt` (so they all
 * schedule at offset zero, arriving together, near-instantly, instead of
 * spread across however many real seconds separated their original arrival
 * times); `validAt` is left untouched, since that's what derived channels
 * (e.g. `system.state`) reason about, not scheduling.
 *
 * This is what makes seeking forward correct for slow-changing/keyframed
 * channels: naively truncating to `deliveredAt >= target` would silently
 * drop any topic that hadn't been re-sent since before the seek point.
 */
function buildSeekFixture(
  fixture: ReplayFixture,
  targetDeliveredAt: number,
): ReplayFixture {
  const parsed = fixture.frames
    .map((raw): unknown => JSON.parse(raw))
    .filter(isDataOrEventFrame);

  const snapshotByTopic = new Map<string, DataOrEventMessage>();
  const continuing: DataOrEventMessage[] = [];
  for (const message of parsed) {
    if (message.meta.deliveredAt <= targetDeliveredAt) {
      const existing = snapshotByTopic.get(message.topic);
      if (!existing || message.meta.deliveredAt >= existing.meta.deliveredAt) {
        snapshotByTopic.set(message.topic, message);
      }
    } else {
      continuing.push(message);
    }
  }

  const snapshotFrames = [...snapshotByTopic.values()].map((message) => ({
    ...message,
    meta: { ...message.meta, deliveredAt: targetDeliveredAt },
  }));

  const frames = [...snapshotFrames, ...continuing]
    .sort((a, b) => a.meta.deliveredAt - b.meta.deliveredAt)
    .map((message) => JSON.stringify(message));

  return { subscribedTopics: fixture.subscribedTopics, frames };
}

/** The earliest `meta.deliveredAt` across a fixture's data/event frames, `start()`'s anchor point. `0` for an empty fixture. */
function earliestDeliveredAt(fixture: ReplayFixture): number {
  return deliveredSpan(fixture)?.first ?? 0;
}

/** The earliest and latest `meta.deliveredAt` across a fixture's data/event frames, or `undefined` for a fixture with none. */
function deliveredSpan(
  fixture: ReplayFixture,
): { first: number; last: number } | undefined {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const raw of fixture.frames) {
    const message: unknown = JSON.parse(raw);
    if (!isDataOrEventFrame(message)) continue;
    first = Math.min(first, message.meta.deliveredAt);
    last = Math.max(last, message.meta.deliveredAt);
  }
  return Number.isFinite(first) ? { first, last } : undefined;
}

export interface ReplaySessionSnapshot {
  active: boolean;
  meta: MissionMeta | null;
  client: TelemetryClient | null;
  store: TimelineStore | null;
  playing: boolean;
  rate: number;
}

const IDLE_SNAPSHOT: ReplaySessionSnapshot = {
  active: false,
  meta: null,
  client: null,
  store: null,
  playing: false,
  rate: 1,
};

type Listener = () => void;

/**
 * Owns exactly one in-progress mission replay session, driven by a
 * `ReplayTransport`. Useful for replaying a recorded mission to the operator with
 * play, pause, seek and rate controls. Used by the replay session provider and its
 * banner.
 *
 * It builds a fresh `TelemetryClient` and `TimelineStore` (registering the same
 * derived channels the live stream does) from a mission's `ReplayFixture`, and
 * renders through the ordinary `TelemetryProvider` surface
 * (`ReplaySessionProvider`): a replayed widget is the same component reading the
 * same `useTelemetry` hook a live one does, fed from a different client.
 *
 * Play, pause, seek and rate all resolve to starting a fresh `ReplayTransport`
 * anchored at a chosen point. The schedule of an armed transport is never changed
 * in place: rate is fixed at construction, so a rate change rebuilds the whole
 * replay source.
 */
export class ReplaySessionController {
  private snapshot: ReplaySessionSnapshot = IDLE_SNAPSHOT;
  private fixture: ReplayFixture | null = null;
  private transport: ReplayTransport | null = null;
  /*
   * Where the replay has got to, on the time its frames were delivered at:
   * the instant playback started from, the clock counting from there while it
   * plays, and the last frame's instant, past which there is nothing to reach.
   * The session's view clock cannot stand in for it. That reads the time each
   * sample was valid at, which in a recording made across a signal delay runs
   * the whole delay behind the frames that carry it.
   */
  private cursor: {
    fromUt: number;
    running: Pick<Clock, "now"> | null;
    endUt: number;
  } = { fromUt: 0, running: null, endUt: 0 };
  private readonly listeners = new Set<Listener>();

  getSnapshot(): ReplaySessionSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Start a new session from a mission's stored fixture, playing from the beginning. */
  start(meta: MissionMeta, fixture: ReplayFixture): void {
    this.fixture = fixture;
    const firstDeliveredAt = earliestDeliveredAt(fixture);
    this.launch(meta, firstDeliveredAt, 1, true);
  }

  /** Tear down the active session entirely: back to no `TelemetryProvider` override at all. */
  stop(): void {
    this.transport?.stop();
    this.transport = null;
    this.fixture = null;
    this.cursor = { fromUt: 0, running: null, endUt: 0 };
    this.snapshot = IDLE_SNAPSHOT;
    this.emit();
  }

  /** Freeze playback where it currently sits. `store`/`client` stay mounted (widgets keep showing the last-delivered state), only new frame delivery stops. */
  pause(): void {
    if (!this.snapshot.active) return;
    this.cursor = { ...this.cursor, fromUt: this.cursorUt(), running: null };
    this.transport?.stop();
    this.snapshot = { ...this.snapshot, playing: false };
    this.emit();
  }

  /** Resume from wherever the view currently sits. */
  play(): void {
    if (!this.snapshot.active || !this.fixture || !this.snapshot.meta) return;
    this.launch(this.snapshot.meta, this.cursorUt(), this.snapshot.rate, true);
  }

  /** Jump to `targetUt` (a `deliveredAt`-domain UT: the same domain the mission's `meta.firstFrameUt`/`lastFrameUt` are in). Keeps the current play/pause state. */
  seekTo(targetUt: number): void {
    if (!this.snapshot.active || !this.fixture || !this.snapshot.meta) return;
    this.launch(
      this.snapshot.meta,
      targetUt,
      this.snapshot.rate,
      this.snapshot.playing,
    );
  }

  /** Change playback speed from wherever the view currently sits. */
  setRate(rate: number): void {
    if (!this.snapshot.active || !this.fixture || !this.snapshot.meta) return;
    this.launch(
      this.snapshot.meta,
      this.cursorUt(),
      rate,
      this.snapshot.playing,
    );
  }

  /**
   * Where the replay has got to, as a UT on the time its frames were delivered
   * at: the domain of the mission's `firstFrameUt` and `lastFrameUt`, and of
   * {@link seekTo}. It stands still while paused and stops at the last frame.
   */
  cursorUt(): number {
    const { fromUt, running, endUt } = this.cursor;
    return running ? Math.min(fromUt + running.now(), endUt) : fromUt;
  }

  /**
   * (Re)builds the whole session anchored at `anchorUt`: a fresh
   * `TimelineStore`/`ViewClock` primed with the keyframe snapshot as of
   * `anchorUt` (`buildSeekFixture`), plus, only when `playing`, everything
   * after it, scheduled at `rate`x real time. When not playing, the session
   * still gets built (so the view reflects the new position immediately)
   * but nothing beyond the snapshot is included, so no further frames ever
   * arrive until `play()`/`seekTo()` relaunches.
   */
  private launch(
    meta: MissionMeta,
    anchorUt: number,
    rate: number,
    playing: boolean,
  ): void {
    if (!this.fixture) return;
    this.transport?.stop();

    const seeked = buildSeekFixture(this.fixture, anchorUt);
    const fixture: ReplayFixture = playing
      ? seeked
      : {
          subscribedTopics: seeked.subscribedTopics,
          frames: seeked.frames.filter((raw) => {
            const message: unknown = JSON.parse(raw);
            return (
              isDataOrEventFrame(message) &&
              message.meta.deliveredAt <= anchorUt + 1e-6
            );
          }),
        };

    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);
    for (const channel of PRODUCTION_DERIVED_CHANNELS) {
      store.registerDerivedChannel(channel);
    }

    const transportClock = new ScaledRealTimeClock(Math.max(rate, 0.01));
    const transport = new ReplayTransport(fixture, { clock: transportClock });
    const client = new TelemetryClient(transport);
    client.attachStore(store);

    this.transport = transport;
    /*
     * The transport plays from its fixture's first frame. That is the anchor
     * wherever a frame was delivered by then, and the first frame after it for
     * a seek to before the recording starts.
     */
    const span = deliveredSpan(this.fixture);
    this.cursor = {
      fromUt: playing ? (deliveredSpan(fixture)?.first ?? anchorUt) : anchorUt,
      running: playing ? transportClock : null,
      endUt: Math.max(span?.last ?? anchorUt, anchorUt),
    };
    this.snapshot = { active: true, meta, client, store, playing, rate };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

let singleton: ReplaySessionController | null = null;

export function getReplaySessionController(): ReplaySessionController {
  if (!singleton) singleton = new ReplaySessionController();
  return singleton;
}

/** Test-only: force a fresh singleton so one test's session can't leak into the next. */
export function resetReplaySessionControllerForTests(): void {
  singleton?.stop();
  singleton = null;
}
