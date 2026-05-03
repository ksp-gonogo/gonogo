import { registerDataSource } from "@gonogo/core";
import type { BufferedDataSource } from "../BufferedDataSource";
import type { FlightChapterRecord } from "../types";
import { FLIGHT_FIXTURE_FORMAT, type FlightFixture } from "./FlightFixture";
import { FlightReplayDataSource } from "./FlightReplayDataSource";

/**
 * Public state observable by the banner / FlightsManager UI.
 */
export interface ReplayControllerState {
  active: boolean;
  /** Replay source — present when active, null when idle. */
  replay: FlightReplayDataSource | null;
  /** Source flight metadata (vessel name, launch time, chapters, etc.). */
  flight: FlightFixture["flight"] | null;
  /** Total fixture duration in ms. */
  durationMs: number;
  /** Current playback position (elapsed ms since launchedAt). */
  positionMs: number;
  /** Whether the wall-clock timer is running. */
  playing: boolean;
  /** Wall-clock playback rate (1 = real time). */
  rate: number;
  /** Persisted chapters carried into replay; useful for the seek bar. */
  chapters: FlightChapterRecord[];
}

const IDLE_STATE: ReplayControllerState = {
  active: false,
  replay: null,
  flight: null,
  durationMs: 0,
  positionMs: 0,
  playing: false,
  rate: 1,
  chapters: [],
};

type Listener = (state: ReplayControllerState) => void;

/**
 * Manages in-app replay of a recorded flight. On `start`, exports the
 * flight to a fixture, builds a `FlightReplayDataSource`, and registers
 * it under the `"data"` slot — overriding the live `BufferedDataSource`
 * so every widget reads from replay.
 *
 * On `stop`, restores the original source. The original buffered source
 * is kept connected throughout (it'd be wasteful to tear it down for a
 * temporary swap), so live recording continues silently in the
 * background and the dashboard re-attaches seamlessly on exit.
 *
 * Position tracking polls the replay source on a small interval rather
 * than wiring an event subscriber — replay's clock is internal, polling
 * 4 Hz keeps the seek bar smooth without a dedicated tick API.
 */
export class ReplayController {
  private state: ReplayControllerState = IDLE_STATE;
  private readonly listeners = new Set<Listener>();
  private positionPollTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Source that was registered as `"data"` before replay started — restored
   * verbatim on `stop()`. Stays connected during replay so background
   * recording keeps going.
   */
  private liveSource: BufferedDataSource | null = null;

  getState(): ReplayControllerState {
    return this.state;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /**
   * Begin replaying `flightId`. Exports the flight from `live` (the
   * currently-registered BufferedDataSource), builds a replay source from
   * the resulting fixture, and registers it as the new `"data"` source.
   * Idempotent — calling while a replay is already active stops the
   * previous one first.
   */
  async start(live: BufferedDataSource, flightId: string): Promise<void> {
    if (this.state.active) await this.stop();

    const fixture = await live.exportFlight(flightId);
    const replay = new FlightReplayDataSource({
      fixture,
      id: live.id, // Take over the same registry slot ("data" by default).
      autoplay: false, // The controller drives play/pause.
    });
    await replay.connect();

    this.liveSource = live;
    registerDataSource(replay);

    this.state = {
      active: true,
      replay,
      flight: fixture.flight,
      durationMs: fixture.flight.lastSampleAt - fixture.flight.launchedAt,
      positionMs: 0,
      playing: false,
      rate: 1,
      chapters: fixture.flight.chapters ?? [],
    };
    this.startPolling();
    this.notify();
  }

  /** Restore the live source and tear down replay. No-op when idle. */
  async stop(): Promise<void> {
    if (!this.state.active || !this.liveSource || !this.state.replay) return;
    this.stopPolling();
    this.state.replay.disconnect();
    registerDataSource(this.liveSource);
    this.liveSource = null;
    this.state = IDLE_STATE;
    this.notify();
  }

  play(): void {
    if (!this.state.replay) return;
    this.state.replay.play();
    this.updateState({ playing: true });
  }

  pause(): void {
    if (!this.state.replay) return;
    this.state.replay.pause();
    this.updateState({ playing: false });
  }

  togglePlay(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  /**
   * Seek to an absolute position in elapsed ms (0 = launch).
   */
  seekTo(elapsedMs: number): void {
    if (!this.state.replay || !this.state.flight) return;
    const clamped = Math.max(0, Math.min(elapsedMs, this.state.durationMs));
    const absT = this.state.flight.launchedAt + clamped;
    this.state.replay.seek(absT);
    this.updateState({ positionMs: clamped });
  }

  /** Seek to the start of a chapter by id. */
  seekToChapter(chapterId: string): void {
    const chapter = this.state.chapters.find((c) => c.id === chapterId);
    if (chapter) this.seekTo(chapter.startMs);
  }

  setRate(rate: number): void {
    if (!this.state.replay || !Number.isFinite(rate) || rate <= 0) return;
    // FlightReplayDataSource only reads `rate` at construction time; mirror
    // that constraint here by recreating play with the new rate via
    // pause→reconstruct→play. Cheap because the cursor position survives.
    const wasPlaying = this.state.playing;
    if (wasPlaying) this.state.replay.pause();
    // FlightReplayDataSource doesn't expose a runtime setRate, so pause +
    // resume with the new rate would need access to the constructor knob.
    // Workaround: rebuild the replay source on rate change. Reconnect, copy
    // the cursor over via a seek, restart play if it was playing.
    void this.rebuildReplayWithRate(rate, wasPlaying);
  }

  private async rebuildReplayWithRate(
    rate: number,
    resumePlay: boolean,
  ): Promise<void> {
    if (!this.state.replay || !this.state.flight || !this.liveSource) return;
    const fixture = await this.liveSource.exportFlight(this.state.flight.id);
    const oldReplay = this.state.replay;
    const newReplay = new FlightReplayDataSource({
      fixture,
      id: this.liveSource.id,
      autoplay: false,
      rate,
    });
    await newReplay.connect();
    newReplay.seek(this.state.flight.launchedAt + this.state.positionMs);
    oldReplay.disconnect();
    registerDataSource(newReplay);
    if (resumePlay) newReplay.play();
    this.state = {
      ...this.state,
      replay: newReplay,
      rate,
      playing: resumePlay,
    };
    this.notify();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private startPolling(): void {
    if (this.positionPollTimer) clearInterval(this.positionPollTimer);
    this.positionPollTimer = setInterval(() => {
      if (!this.state.replay || !this.state.flight) return;
      const elapsed = this.state.replay.now() - this.state.flight.launchedAt;
      if (elapsed !== this.state.positionMs) {
        this.updateState({ positionMs: elapsed });
      }
    }, 250);
  }

  private stopPolling(): void {
    if (this.positionPollTimer) {
      clearInterval(this.positionPollTimer);
      this.positionPollTimer = null;
    }
  }

  private updateState(patch: Partial<ReplayControllerState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  private notify(): void {
    for (const cb of this.listeners) cb(this.state);
  }
}

/**
 * Module-singleton controller. The dashboard mounts one banner + one
 * controller; FlightsManager and the banner both talk to this same
 * instance.
 */
let singleton: ReplayController | null = null;

export function getReplayController(): ReplayController {
  if (!singleton) singleton = new ReplayController();
  return singleton;
}

/** Test-only — wipe the singleton between specs. */
export function resetReplayController(): void {
  singleton = null;
}

// Re-export the format tag so consumers don't need a second import.
export { FLIGHT_FIXTURE_FORMAT };
