import {
  type DataSource,
  getDataSource,
  registerDataSource,
} from "@gonogo/core";
import type { BufferedDataSource } from "../BufferedDataSource";
import type { FlightChapterRecord } from "../types";
import { FLIGHT_FIXTURE_FORMAT, type FlightFixture } from "./FlightFixture";
import { FlightReplayDataSource } from "./FlightReplayDataSource";

/**
 * Source ids the controller takes over during replay. The replay source is
 * registered under each of these so widgets reading from any of them see
 * captured samples instead of live data. The originals are stashed at
 * `start()` and restored verbatim at `stop()`.
 *
 * `kos` covers the centralised compute fanout (ShipMap, KosProcessors,
 * TargetPicker vessel list). RPC paths (`executeScript`) get a no-op
 * stub on `FlightReplayDataSource`; widgets that explicitly need to
 * suppress RPCs check `useReplayActive()`.
 */
const SWAP_SOURCE_IDS = ["data", "kos"] as const;

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
  /**
   * Snapshot of every source we displaced. Re-registered verbatim on stop.
   * Kept connected throughout — only the registry slot is swapped.
   */
  private displacedSources = new Map<string, DataSource>();

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
    this.liveSource = live;

    // Stash every source we're about to displace, then register the same
    // replay instance under each id so widgets reading from any of them see
    // captured samples. One replay source serves both `"data"` and `"kos"`
    // because the fixture contains keys from both namespaces (Telemachus
    // `v.altitude` etc and `kos.compute.<topic>.<field>`).
    //
    // The replay's `.id` property reads as `"data"` even when retrieved
    // via `getDataSource("kos")` — the registry slot is the source of
    // truth, the field is informational. Widgets keying off `source.id`
    // would see the mismatch; nothing in the codebase does today.
    this.displacedSources.clear();
    for (const id of SWAP_SOURCE_IDS) {
      const existing = getDataSource(id);
      if (existing) this.displacedSources.set(id, existing);
    }

    const replay = new FlightReplayDataSource({
      fixture,
      id: live.id,
      autoplay: false,
    });
    await replay.connect();

    // The replay's class id is `live.id` (typically `"data"`). For other
    // slots we need a thin override that exposes the same source under a
    // different id — handed to the registry directly.
    for (const id of SWAP_SOURCE_IDS) {
      if (id === replay.id) {
        registerDataSource(replay);
      } else {
        registerDataSource(makeIdProxy(replay, id));
      }
    }

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
    // Restore each displaced source to its original registry slot.
    for (const [, src] of this.displacedSources) {
      registerDataSource(src);
    }
    this.displacedSources.clear();
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
 * Wrap a `DataSource` with a different `id`, forwarding every method to
 * the wrapped instance. Used so a single `FlightReplayDataSource` can
 * sit in multiple registry slots (`"data"`, `"kos"`) at once during
 * replay. Only forwards the standard DataSource surface — extra methods
 * on subclasses (e.g. `executeScript`, `getTopicStatus`) are reachable
 * via `Object.getPrototypeOf` lookups but the proxy doesn't enumerate
 * them upfront.
 */
function makeIdProxy(source: DataSource, id: string): DataSource {
  return new Proxy(source, {
    get(target, prop, receiver) {
      if (prop === "id") return id;
      const value = Reflect.get(target, prop, receiver);
      // Re-bind methods so `this` inside the source is still the original.
      // Without this, calls like `proxy.subscribe(...)` would lose the
      // KosComputeManager / FlightReplayDataSource internal state.
      if (typeof value === "function") return value.bind(target);
      return value;
    },
  });
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
