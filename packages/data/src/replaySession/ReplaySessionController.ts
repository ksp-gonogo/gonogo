import type { Clock, ReplayFixture } from "@ksp-gonogo/sitrep-client";
import {
  PRODUCTION_DERIVED_CHANNELS,
  ReplayTransport,
  TelemetryClient,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import type { MissionMeta } from "../storage/MissionStore";

/**
 * `Clock` that runs `rate`x real wall-clock speed, anchored at construction
 * (`now()` starts at 0) — `ReplayTransport` computes every frame's fire time
 * relative to that anchor, so this is all it needs to honor the fixture's
 * own `deliveredAt` cadence at an adjustable playback speed. `rate` is
 * intentionally NOT mutable mid-flight (matches the pre-existing
 * `ReplayController.setRate` precedent this replaces: rate is
 * constructor-only, changing it means rebuilding the session — see
 * `ReplaySessionController.setRate`).
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

function isDataOrEventFrame(
  message: ServerMessage,
): message is DataOrEventMessage {
  return message.type === "stream-data" || message.type === "event";
}

/**
 * Builds a synthetic fixture anchored at `targetDeliveredAt`: for every
 * topic, keeps only its LATEST frame at-or-before the target (a "keyframe
 * snapshot" of everything known as of that instant — mirrors the retired
 * `FlightReplayDataSource.seek()`'s own "rewind snapshot" behaviour), plus
 * every frame strictly after the target unchanged. The snapshot frames'
 * `meta.deliveredAt` is rewritten to `targetDeliveredAt` (so they all
 * schedule at offset zero — arriving together, near-instantly — instead of
 * spread across however many real seconds separated their ORIGINAL arrival
 * times); `validAt` is left untouched, since that's what derived channels
 * (e.g. `vessel.state.met`) reason about, not scheduling.
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
    .map((raw) => JSON.parse(raw) as ServerMessage)
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

/** The earliest `meta.deliveredAt` across a fixture's data/event frames — `start()`'s anchor point. `0` for an empty fixture. */
function earliestDeliveredAt(fixture: ReplayFixture): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const raw of fixture.frames) {
    const message = JSON.parse(raw) as ServerMessage;
    if (!isDataOrEventFrame(message)) continue;
    if (message.meta.deliveredAt < earliest)
      earliest = message.meta.deliveredAt;
  }
  return Number.isFinite(earliest) ? earliest : 0;
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
 * Owns exactly one in-progress mission replay session — the
 * `ReplayTransport`-based replacement for the retired `ReplayController` /
 * `FlightReplayDataSource`. Builds a fresh `TelemetryClient` +
 * `TimelineStore` (registering the SAME production derived channels the
 * live stream does) from a mission's `ReplayFixture`, and renders through
 * the ordinary `TelemetryProvider` surface (`ReplaySessionProvider`) — a
 * replayed widget is the exact same component reading the exact same
 * `useTelemetry`/`useDataValue` hooks a live one does, just fed from a
 * different client.
 *
 * Play/pause/seek/rate all resolve to (re)starting a fresh
 * `ReplayTransport` anchored at a chosen point — never live in-place
 * mutation of an already-armed transport's schedule — matching the
 * `ReplayController.setRate` precedent this replaces ("rebuilds the whole
 * replay source since rate is constructor-only").
 */
export class ReplaySessionController {
  private snapshot: ReplaySessionSnapshot = IDLE_SNAPSHOT;
  private fixture: ReplayFixture | null = null;
  private transport: ReplayTransport | null = null;
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

  /** Tear down the active session entirely — back to no `TelemetryProvider` override at all. */
  stop(): void {
    this.transport?.stop();
    this.transport = null;
    this.fixture = null;
    this.snapshot = IDLE_SNAPSHOT;
    this.emit();
  }

  /** Freeze playback where it currently sits. `store`/`client` stay mounted (widgets keep showing the last-delivered state) — only new frame delivery stops. */
  pause(): void {
    if (!this.snapshot.active) return;
    this.transport?.stop();
    this.snapshot = { ...this.snapshot, playing: false };
    this.emit();
  }

  /** Resume from wherever the view currently sits. */
  play(): void {
    if (!this.snapshot.active || !this.fixture || !this.snapshot.meta) return;
    this.launch(
      this.snapshot.meta,
      this.currentViewUt(),
      this.snapshot.rate,
      true,
    );
  }

  /** Jump to `targetUt` (a `deliveredAt`-domain UT — the same domain the mission's `meta.firstFrameUt`/`lastFrameUt` are in). Keeps the current play/pause state. */
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
      this.currentViewUt(),
      rate,
      this.snapshot.playing,
    );
  }

  private currentViewUt(): number {
    return this.snapshot.store?.clock.viewUt() ?? 0;
  }

  /**
   * (Re)builds the whole session anchored at `anchorUt`: a fresh
   * `TimelineStore`/`ViewClock` primed with the keyframe snapshot as of
   * `anchorUt` (`buildSeekFixture`), plus — only when `playing` — everything
   * after it, scheduled at `rate`x real time. When NOT playing, the session
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
            const message = JSON.parse(raw) as DataOrEventMessage;
            return message.meta.deliveredAt <= anchorUt + 1e-6;
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
