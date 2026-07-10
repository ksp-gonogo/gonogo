/**
 * Main-screen aggregator for GO/NO-GO readiness + post-launch abort.
 *
 * Tracks:
 *   - which peers are connected
 *   - each peer's self-reported station name
 *   - each peer's current vote (go / no-go / null = no widget mounted)
 *   - launch state (derived from v.missionTime crossing 0)
 *   - countdown lifecycle when all peers vote go
 *   - abort trigger + attribution when a station pushes the button post-launch
 *
 * Subscribable: exposes a shallow snapshot; emits on any state change so
 * the React UI can render via useSyncExternalStore / useState+useEffect.
 */

import type { DataSource } from "@ksp-gonogo/core";
import { getDataSource } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import type { PeerHostService } from "../peer/PeerHostService";
import { playAbortTone, playCountdownTone } from "../sound";

export type Vote = "go" | "no-go" | null;

export interface StationSnapshot {
  peerId: string;
  name: string;
  status: Vote;
  /** Station's reported gonogo version. Undefined for pre-versioned bundles. */
  version?: string;
  buildTime?: string;
}

export interface GoNoGoSnapshot {
  stations: StationSnapshot[];
  countdown: { t0Ms: number } | null;
  launched: boolean;
  abort: { peerId: string; stationName: string; at: number } | null;
  config: GoNoGoConfig;
}

export interface GoNoGoConfig {
  countdownLengthMs: number;
  triggerStageAtZero: boolean;
}

export const DEFAULT_GONOGO_CONFIG: GoNoGoConfig = {
  countdownLengthMs: 10_000,
  triggerStageAtZero: true,
};

type Listener = () => void;

export class GoNoGoHostService {
  private peerIdToName = new Map<string, string>();
  private peerIdToVote = new Map<string, Vote>();
  private peerIdToVersion = new Map<
    string,
    { version: string; buildTime: string }
  >();
  private connectedPeers = new Set<string>();
  private countdown: {
    t0Ms: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private launched = false;
  private abort: { peerId: string; stationName: string; at: number } | null =
    null;
  private config: GoNoGoConfig = { ...DEFAULT_GONOGO_CONFIG };
  private listeners = new Set<Listener>();
  private unsubs: Array<() => void> = [];
  private dataSource: DataSource | undefined;

  constructor(
    private host: PeerHostService,
    dataSourceId: string = "data",
  ) {
    this.dataSource = getDataSource(dataSourceId);

    this.unsubs.push(
      host.onPeerConnect((peerId) => {
        this.connectedPeers.add(peerId);
        // Rule: a new station can't have voted yet, so the "all green"
        // condition is broken. Cancel any in-flight countdown.
        this.cancelCountdownIfRunning("new station joined");
        this.emit();
      }),
    );

    this.unsubs.push(
      host.onPeerDisconnect((peerId) => {
        this.connectedPeers.delete(peerId);
        this.peerIdToName.delete(peerId);
        this.peerIdToVote.delete(peerId);
        this.peerIdToVersion.delete(peerId);
        this.cancelCountdownIfRunning("station disconnected");
        this.emit();
      }),
    );

    this.unsubs.push(
      host.onStationInfo((peerId, info) => {
        this.peerIdToName.set(peerId, info.name);
        const prevVer = this.peerIdToVersion.get(peerId);
        if (info.version) {
          if (prevVer?.version !== info.version) {
            this.peerIdToVersion.set(peerId, {
              version: info.version,
              buildTime: info.buildTime ?? "",
            });
          }
        }
        this.emit();
      }),
    );

    this.unsubs.push(
      host.onGonogoVote((peerId, status) => {
        this.peerIdToVote.set(peerId, status);
        if (status === "go") {
          this.maybeStartCountdown();
        } else {
          this.cancelCountdownIfRunning(
            `vote flipped to ${status ?? "missing"}`,
          );
        }
        this.emit();
      }),
    );

    this.unsubs.push(
      host.onGonogoAbort((peerId) => {
        if (!this.launched) return;
        // If an abort is already on record, treat this as a re-notification
        // (station reconnecting after a host refresh). Rebroadcast the
        // attribution so any fresh/reconnecting stations learn who aborted,
        // but don't re-fire f.abort — the action group is a toggle in
        // Telemachus and double-firing would undo it.
        if (this.abort) {
          this.host.broadcast({
            type: "gonogo-abort-notify",
            stationName: this.abort.stationName,
            t: this.abort.at,
          });
          return;
        }
        const stationName = this.peerIdToName.get(peerId) ?? "Unknown station";
        this.abort = { peerId, stationName, at: Date.now() };
        // Abort alert tone — fired alongside f.abort on the first-abort path
        // (the re-notify branch above returns early, so a station re-sending
        // within the same host session doesn't chime twice). The tone is
        // deliberately coupled to f.abort: a main-screen *reload* mid-abort
        // builds a fresh host with no abort memory and re-fires both f.abort
        // and this tone — inherited f.abort behaviour, not introduced here.
        // Internally gated by isSoundEnabled(); main-only.
        playAbortTone();
        void this.dataSource?.execute("f.abort");
        this.host.broadcast({
          type: "gonogo-abort-notify",
          stationName,
          t: this.abort.at,
        });
        this.emit();
      }),
    );

    if (this.dataSource) {
      this.unsubs.push(
        this.dataSource.subscribe("v.missionTime", (value) => {
          const mt = typeof value === "number" ? value : 0;
          const wasLaunched = this.launched;
          this.launched = mt > 0;
          if (wasLaunched && !this.launched) {
            // Revert to pad — clear abort so the operator can try again.
            this.abort = null;
          }
          if (this.launched && this.countdown) {
            this.cancelCountdownIfRunning("launch detected");
          }
          if (wasLaunched !== this.launched || wasLaunched) this.emit();
        }),
      );
    } else {
      logger.warn(
        `[GoNoGoHostService] no '${dataSourceId}' data source — launch/abort disabled`,
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────

  getSnapshot(): GoNoGoSnapshot {
    const stations: StationSnapshot[] = [];
    for (const peerId of this.connectedPeers) {
      const ver = this.peerIdToVersion.get(peerId);
      stations.push({
        peerId,
        name: this.peerIdToName.get(peerId) ?? "Unknown",
        status: this.peerIdToVote.get(peerId) ?? null,
        version: ver?.version,
        buildTime: ver?.buildTime || undefined,
      });
    }
    return {
      stations,
      countdown: this.countdown ? { t0Ms: this.countdown.t0Ms } : null,
      launched: this.launched,
      abort: this.abort,
      config: { ...this.config },
    };
  }

  setConfig(partial: Partial<GoNoGoConfig>): void {
    const next = { ...this.config, ...partial };
    if (
      next.countdownLengthMs === this.config.countdownLengthMs &&
      next.triggerStageAtZero === this.config.triggerStageAtZero
    ) {
      return;
    }
    this.config = next;
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.countdown) clearTimeout(this.countdown.timer);
    this.countdown = null;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.listeners.clear();
  }

  // ───────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────

  private maybeStartCountdown(): void {
    if (this.launched) return;
    if (this.countdown) return;
    if (this.connectedPeers.size === 0) return;
    for (const peerId of this.connectedPeers) {
      if (this.peerIdToVote.get(peerId) !== "go") return;
    }
    const t0Ms = Date.now() + this.config.countdownLengthMs;
    const timer = setTimeout(() => {
      this.onCountdownReached();
    }, this.config.countdownLengthMs);
    this.countdown = { t0Ms, timer };
    this.host.broadcast({ type: "gonogo-countdown-start", t0Ms });
  }

  private cancelCountdownIfRunning(reason: string): void {
    if (!this.countdown) return;
    clearTimeout(this.countdown.timer);
    this.countdown = null;
    this.host.broadcast({ type: "gonogo-countdown-cancel", reason });
  }

  private onCountdownReached(): void {
    if (!this.countdown) return;
    this.countdown = null;
    // T-0 commit tone. Fired here (not in CountdownTone) because the
    // component unmounts the instant the countdown clears, so a 100ms tick
    // can't reliably observe secondsLeft === 0. This is the success path
    // (vs. cancelCountdownIfRunning), so it only chimes on a real T-0.
    // Internally gated by isSoundEnabled(); main-only since this service
    // is instantiated only on MainScreen.
    playCountdownTone(true);
    if (this.config.triggerStageAtZero) {
      void this.dataSource?.execute("f.stage");
    }
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
