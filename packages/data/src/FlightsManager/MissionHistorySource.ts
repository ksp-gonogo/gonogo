import type {
  ConfigField,
  DataSource,
  DataSourceStatus,
} from "@ksp-gonogo/core";
import { PerfBudget } from "@ksp-gonogo/core";
import {
  buildFullHistoryStore,
  mapTopic,
  type ReplayFixture,
  TELEMACHUS_KNOWN_GAPS,
  type TimelineStore,
} from "@ksp-gonogo/sitrep-client";
import { ListenerSet } from "../ListenerSet";
import { enrichKey, TELEMACHUS_META } from "../schema/telemachusMeta";
import type {
  MissionMeta,
  MissionRecord,
  MissionStore,
} from "../storage/MissionStore";
import type {
  DataKeyMeta,
  FlightChapterRecord,
  FlightRecord,
  SeriesRange,
} from "../types";

/**
 * Full-history-store rebuilds are one-shot/user-triggered (panel expand),
 * never a steady-state loop — but `MissionHistorySource` is still a
 * registry-visible `DataSource`, and CLAUDE.md's rule ("any new data source
 * MUST register a sample-rate/dispatch-rate PerfBudget") is written to catch
 * exactly the failure mode a memoization bug here would cause: a cache-key
 * miss on every render turning "expand one graph panel" into "replay this
 * mission's entire fixture every frame". Threshold is generous (rebuilding
 * the same or a handful of different missions within a minute is normal
 * click-around use; dozens/sec is a real regression) — this is a defensive
 * tripwire, not a steady-state capacity budget.
 */
const FULL_HISTORY_REBUILD_BUDGET = new PerfBudget({
  name: "MissionHistorySource full-history rebuilds/min",
  threshold: 20,
  windowMs: 60_000,
  unit: "rebuilds",
});

/**
 * Legacy Telemachus keys with no queryable stream equivalent — filtered out
 * of `schema()` the same way `BufferedDataSource`'s live schema never
 * offered them; nothing to `sampleRange` against.
 */
function isGapKey(key: string): boolean {
  return TELEMACHUS_KNOWN_GAPS.has(key);
}

/**
 * The `"data"`/`BufferedDataSource` replacement for the flight-history
 * surface (`FlightsManager`, `FlightGraph`, `ChaptersEditor`, and the
 * flight-history peer RPCs) — reads exclusively off `MissionStore`'s
 * "press record" recordings instead of always-on Telemachus capture.
 *
 * Registered under a FRESH id (`"missionHistory"`, see
 * `packages/app/src/dataSources/missionHistory.ts`) rather than reusing
 * `"data"` — `"data"`/`BufferedDataSource` are being deleted wholesale in a
 * later pass (P4c-b) and are untouched by this port.
 *
 * Per-mission `queryRange` reads are served by replaying that mission's
 * `ReplayFixture` through `buildFullHistoryStore` (unbounded retention,
 * unlike every live `TimelineStore`) and caching the resulting store by
 * mission id — `evictFullHistoryStore` lets a caller (the FlightGraph panel,
 * on collapse/unmount) drop the cache entry rather than holding a whole
 * mission's frame history in memory indefinitely.
 */
export class MissionHistorySource implements DataSource {
  readonly id = "missionHistory";
  readonly name = "Mission History";
  status: DataSourceStatus = "connected";

  private readonly flightListSubscribers = new ListenerSet();
  private readonly historyCache = new Map<string, Promise<TimelineStore>>();

  constructor(private readonly missionStore: MissionStore) {}

  // --- DataSource ----------------------------------------------------------
  // No live connection: this source only ever reads IndexedDB. Always
  // "connected" — there's nothing to reconnect or fail.

  async connect(): Promise<void> {}

  disconnect(): void {}

  schema(): DataKeyMeta[] {
    return Object.keys(TELEMACHUS_META)
      .filter((key) => !isGapKey(key))
      .map((key) => ({ key, ...enrichKey(key) }));
  }

  subscribe(_key: string, _cb: (value: unknown) => void): () => void {
    // No live values to push — Missions are finished recordings, read only
    // through queryRange. Matches BufferedDataSource's contract shape
    // without a live upstream: return a no-op unsubscribe.
    return () => {};
  }

  onStatusChange(_cb: (status: DataSourceStatus) => void): () => void {
    return () => {};
  }

  async execute(_action: string): Promise<void> {}

  configSchema(): ConfigField[] {
    return [];
  }

  configure(_config: Record<string, unknown>): void {}

  getConfig(): Record<string, unknown> {
    return {};
  }

  // --- Flight-history surface ----------------------------------------------

  async queryRange(
    key: string,
    fromUt: number,
    toUt: number,
    missionId?: string,
  ): Promise<SeriesRange> {
    if (!missionId) return { t: [], v: [] };
    const topic = mapTopic("data", key);
    if (!topic) return { t: [], v: [] };

    const store = await this.getFullHistoryStore(missionId);
    if (!store) return { t: [], v: [] };

    const points = store.sampleRange(topic, fromUt, toUt);
    if (!points) return { t: [], v: [] };
    return {
      t: points.map((p) => p.validAt),
      v: points.map((p) => p.payload),
    };
  }

  async listFlights(): Promise<FlightRecord[]> {
    const missions = await this.missionStore.listMissions();
    return missions.map(missionMetaToFlightRecord);
  }

  async getFlight(id: string): Promise<FlightRecord | null> {
    const meta = await this.missionStore.getMissionMeta(id);
    return meta ? missionMetaToFlightRecord(meta) : null;
  }

  /**
   * Persists a finished recording AND fires `onFlightListChange` — the only
   * correct way to save a new mission. A caller that instead writes straight
   * to its own `MissionStore` instance (bypassing this method) still lands
   * the row in IndexedDB, but `PeerHostService.attachFlightListChangeBroadcaster`
   * only forwards THIS source's `onFlightListChange`, so connected stations
   * never learn a new recording exists until some unrelated mutation fires
   * the listener (or they reconnect). See `RecordingControls.stopRecording`.
   */
  async saveMission(record: MissionRecord): Promise<void> {
    await this.missionStore.saveMission(record);
    this.flightListSubscribers.fire();
  }

  async exportFlight(id: string): Promise<ReplayFixture> {
    const loaded = await this.missionStore.getMissionFixture(id);
    return loaded?.fixture ?? { frames: [] };
  }

  async deleteFlight(id: string): Promise<void> {
    await this.missionStore.deleteMission(id);
    this.historyCache.delete(id);
    this.flightListSubscribers.fire();
  }

  async clearAllFlights(): Promise<void> {
    await this.missionStore.clearAllMissions();
    this.historyCache.clear();
    this.flightListSubscribers.fire();
  }

  async setFlightStarred(id: string, starred: boolean): Promise<void> {
    const meta = await this.missionStore.getMissionMeta(id);
    if (!meta || Boolean(meta.starred) === starred) return;
    await this.missionStore.updateMissionMeta(id, { starred });
    this.flightListSubscribers.fire();
  }

  async addChapter(
    missionId: string,
    chapter: Omit<FlightChapterRecord, "id"> & { id?: string },
  ): Promise<FlightRecord | null> {
    const meta = await this.missionStore.getMissionMeta(missionId);
    if (!meta) return null;
    const id =
      chapter.id ??
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const next: FlightChapterRecord = {
      id,
      label: chapter.label,
      startMs: chapter.startMs,
      endMs: chapter.endMs,
    };
    const chapters = [...(meta.chapters ?? []), next];
    await this.missionStore.updateMissionMeta(missionId, { chapters });
    this.flightListSubscribers.fire();
    return missionMetaToFlightRecord({ ...meta, chapters });
  }

  async updateChapter(
    missionId: string,
    chapterId: string,
    patch: Partial<Omit<FlightChapterRecord, "id">>,
  ): Promise<FlightRecord | null> {
    const meta = await this.missionStore.getMissionMeta(missionId);
    if (!meta) return null;
    const chapters = (meta.chapters ?? []).map((c) =>
      c.id === chapterId ? { ...c, ...patch } : c,
    );
    await this.missionStore.updateMissionMeta(missionId, { chapters });
    this.flightListSubscribers.fire();
    return missionMetaToFlightRecord({ ...meta, chapters });
  }

  async removeChapter(
    missionId: string,
    chapterId: string,
  ): Promise<FlightRecord | null> {
    const meta = await this.missionStore.getMissionMeta(missionId);
    if (!meta) return null;
    const chapters = (meta.chapters ?? []).filter((c) => c.id !== chapterId);
    await this.missionStore.updateMissionMeta(missionId, { chapters });
    this.flightListSubscribers.fire();
    return missionMetaToFlightRecord({ ...meta, chapters });
  }

  async pruneFlightsKeepLatest(opts: { keepCount: number }): Promise<string[]> {
    const removed = await this.missionStore.pruneMissionsKeepLatest(opts);
    for (const id of removed) this.historyCache.delete(id);
    if (removed.length > 0) this.flightListSubscribers.fire();
    return removed;
  }

  onFlightListChange(cb: () => void): () => void {
    return this.flightListSubscribers.add(cb);
  }

  /**
   * Drops one mission's cached full-history store (or all of them when
   * called with no id) — called by `FlightGraph` on panel collapse/unmount
   * so a long FlightsManager session graphing many missions doesn't hold
   * every one's entire frame history in memory forever.
   */
  evictFullHistoryStore(missionId?: string): void {
    if (missionId) this.historyCache.delete(missionId);
    else this.historyCache.clear();
  }

  // --- Internal --------------------------------------------------------

  private async getFullHistoryStore(
    missionId: string,
  ): Promise<TimelineStore | undefined> {
    const cached = this.historyCache.get(missionId);
    if (cached) return cached;

    const built = (async () => {
      const loaded = await this.missionStore.getMissionFixture(missionId);
      if (!loaded) throw new Error(`mission fixture not found: ${missionId}`);
      FULL_HISTORY_REBUILD_BUDGET.record();
      return buildFullHistoryStore(loaded.fixture);
    })();
    this.historyCache.set(missionId, built);
    try {
      return await built;
    } catch {
      this.historyCache.delete(missionId);
      return undefined;
    }
  }
}

function missionMetaToFlightRecord(meta: MissionMeta): FlightRecord {
  const elapsedMs = Math.max(0, (meta.lastFrameUt - meta.firstFrameUt) * 1000);
  return {
    id: meta.id,
    vesselName: meta.vesselName,
    launchedAt: meta.launchedAt,
    lastSampleAt: meta.launchedAt + elapsedMs,
    // Missions have no live revert-detection concept (a mission only exists
    // once recording has finished) — this field is unused by
    // MissionHistorySource; kept populated (elapsed UT seconds) only for
    // FlightRecord shape compatibility with existing consumers.
    lastMissionTime: meta.lastFrameUt - meta.firstFrameUt,
    sampleCount: meta.frameCount,
    starred: meta.starred,
    chapters: meta.chapters,
    // No Mission/stream equivalent captured yet — see the port plan's risk
    // flag on `outcome`. `crash.lastCrash` has a stream topic today but is a
    // single global "last notable crash" event slot, not mission-scoped or
    // queryRange-able, and there is no stream equivalent at all yet for
    // `recovery.lastSummary`. Wiring outcome capture into StreamRecorder (or
    // MissionMeta) is a real, separate follow-up, not silently dropped.
    outcome: undefined,
    firstFrameUt: meta.firstFrameUt,
    lastFrameUt: meta.lastFrameUt,
  };
}
