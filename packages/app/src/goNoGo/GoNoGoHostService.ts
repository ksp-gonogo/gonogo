/**
 * Main-screen aggregator for GO/NO-GO readiness + post-launch abort.
 *
 * Tracks:
 *   - which peers are connected
 *   - each peer's self-reported station name
 *   - each peer's current vote (go / no-go / null = no widget mounted)
 *   - launch state (derived from the mission elapsed time crossing 0)
 *   - countdown lifecycle when all peers vote go
 *   - abort trigger + attribution when a station pushes the button post-launch
 *
 * Subscribable: exposes a shallow snapshot; emits on any state change so
 * the React UI can render via useSyncExternalStore / useState+useEffect.
 */

import { logger } from "@ksp-gonogo/logger";
import {
  dispatchActiveCommandTopic,
  getVesselIdentity,
  getViewUt,
  onActiveTimelineFrame,
} from "@ksp-gonogo/sitrep-client";
import { Situation, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import type { PeerHostService } from "../peer/PeerHostService";
import { playAbortTone, playCountdownTone } from "../sound";

/** The slice of the peer host this aggregator reads: five lifecycle subscriptions plus the broadcast it sends on. */
type GoNoGoHost = Pick<
  PeerHostService,
  | "onPeerConnect"
  | "onPeerDisconnect"
  | "onStationInfo"
  | "onGonogoVote"
  | "onGonogoAbort"
  | "broadcast"
>;

/**
 * Seconds since liftoff on the view clock, or `null` before the clamps release
 * and whenever no stream has produced a liftoff instant yet.
 *
 * The view clock rather than the wall clock, so the launch state this service
 * publishes agrees with every mission clock drawn against the same frame.
 */
function missionElapsed(): Value<"s"> | null {
  const launchUt = getVesselIdentity()?.launchUt;
  const viewUt = getViewUt();
  if (launchUt == null || viewUt === undefined || !launchUt.isFinite()) {
    return null;
  }
  return viewUt.minus(launchUt);
}

export type Vote = "go" | "no-go" | null;

export interface StationSnapshot {
  peerId: string;
  name: string;
  status: Vote;
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
  private connectedPeers = new Set<string>();
  private countdown: {
    t0Ms: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private launched = false;
  private abortInFlight = false;
  /**
   * Set when a countdown reaches T-0, and what keeps a second one from
   * starting. `launched` cannot do that job: it turns true only when the
   * craft's own mission time arrives, which under signal delay is later than
   * T-0, and a vote repeated in between would count down and stage again.
   * Cleared when the poll stops passing, when the craft is back on the pad, or
   * when the stage was not taken.
   */
  private committed = false;
  private abort: { peerId: string; stationName: string; at: number } | null =
    null;
  private config: GoNoGoConfig = { ...DEFAULT_GONOGO_CONFIG };
  private listeners = new Set<Listener>();
  private unsubs: Array<() => void> = [];

  constructor(private host: GoNoGoHost) {
    this.unsubs.push(
      host.onPeerConnect((peerId) => {
        // A screen that has just joined has no vote, and a screen with no vote is not in the poll: its first vote decides what it does to a countdown.
        this.connectedPeers.add(peerId);
        this.emit();
      }),
    );

    this.unsubs.push(
      host.onPeerDisconnect((peerId) => {
        this.connectedPeers.delete(peerId);
        this.peerIdToName.delete(peerId);
        this.peerIdToVote.delete(peerId);
        this.cancelCountdownIfRunning("station disconnected");
        this.emit();
      }),
    );

    this.unsubs.push(
      host.onStationInfo((peerId, info) => {
        this.peerIdToName.set(peerId, info.name);
        this.emit();
      }),
    );

    this.unsubs.push(
      host.onGonogoVote((peerId, status) => {
        this.peerIdToVote.set(peerId, status);
        if (this.pollIsGo()) {
          this.maybeStartCountdown();
        } else {
          this.committed = false;
          this.cancelCountdownIfRunning(
            status === null
              ? "the last GO vote was withdrawn"
              : `vote flipped to ${status}`,
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
        // but don't re-fire f.abort: the action group is a toggle and
        // double-firing would undo it.
        if (this.abort) {
          this.host.broadcast({
            type: "gonogo-abort-notify",
            stationName: this.abort.stationName,
            t: this.abort.at,
          });
          return;
        }
        // One abort is on its way to the craft: a second press adds nothing until its outcome is known.
        if (this.abortInFlight) return;
        const stationName = this.peerIdToName.get(peerId) ?? "Unknown station";
        void this.sendAbort(peerId, stationName);
      }),
    );

    // Launch state comes off the stream, via `onActiveTimelineFrame`, which re-runs on every ingested frame.
    this.unsubs.push(
      onActiveTimelineFrame(() => {
        // A craft on the pad has no launch clock, so `met` is null there rather
        // than 0, and a null is also what a frame without identity yet reads. The
        // situation is what says "on the pad", which a revert to launch needs.
        if (getVesselIdentity()?.situation === Situation.PreLaunch) {
          this.handleMissionTime(value("s", 0));
          return;
        }
        const met = missionElapsed();
        if (met != null) this.handleMissionTime(met);
      }),
    );
  }

  /** The launch-state transition for one mission elapsed time. */
  private handleMissionTime(missionTime: Value<"s">): void {
    const wasLaunched = this.launched;
    this.launched = missionTime.isPositive();
    if (wasLaunched && !this.launched) {
      // Revert to pad: clear abort so the operator can try again.
      this.abort = null;
      this.committed = false;
    }
    if (this.launched && this.countdown) {
      this.cancelCountdownIfRunning("launch detected");
    }
    if (wasLaunched !== this.launched || wasLaunched) this.emit();
  }

  /**
   * Send the abort and, only once the craft has taken it, record it, sound the
   * alert and tell every station who aborted. An abort that had no stream to
   * travel on, or that the game refused, is recorded nowhere, so the next press
   * from any station sends it again.
   */
  private async sendAbort(peerId: string, stationName: string): Promise<void> {
    this.abortInFlight = true;
    const refusal = await this.dispatchCommand("vessel.control.setAbort", {
      enabled: true,
    });
    this.abortInFlight = false;
    if (refusal !== undefined) {
      logger.warn(
        `[GoNoGoHost] abort from ${stationName} not sent: ${refusal}`,
      );
      return;
    }
    // A craft back on the pad by the time the outcome arrived has no abort to show.
    if (!this.launched || this.abort) return;
    this.abort = { peerId, stationName, at: Date.now() };
    // Internally gated by isSoundEnabled(); main-only.
    playAbortTone();
    this.host.broadcast({
      type: "gonogo-abort-notify",
      stationName,
      t: this.abort.at,
    });
    this.emit();
  }

  /**
   * Fire a command through the stream, naming it and its arguments directly,
   * and resolve with why it did not take effect, or `undefined` when it did.
   *
   * Never through a widget-facing action string, which costs the abort twice
   * over: an action string resolves to a toggle bridge, reading
   * `vessel.control.abort` and sending the negation, so an abort raised while
   * one was already engaged would clear it, and an abort raised while nothing
   * had subscribed to `vessel.control` would resolve to nothing at all and
   * dispatch silently nowhere. Neither is a thing an abort vote can be allowed
   * to do.
   *
   * Naming `setAbort` with an absolute `true` says what the operator meant, and
   * needs no current value to say it.
   */
  private async dispatchCommand(
    command: string,
    args: unknown,
  ): Promise<string | undefined> {
    const outcome = dispatchActiveCommandTopic(command, args);
    if (!outcome.routed) return "no telemetry stream is connected";
    const refusal = await outcome.settled;
    return refusal?.message;
  }

  getSnapshot(): GoNoGoSnapshot {
    const stations: StationSnapshot[] = [];
    for (const peerId of this.connectedPeers) {
      stations.push({
        peerId,
        name: this.peerIdToName.get(peerId) ?? "Unknown",
        status: this.peerIdToVote.get(peerId) ?? null,
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

  /**
   * Whether the poll passes: at least one connected screen has voted "GO" and
   * none has voted "NO-GO". A screen with no vote is not in the poll, whether
   * it never showed the widget or has removed it, so it neither blocks a
   * countdown nor counts towards one. No votes at all does not pass.
   */
  private pollIsGo(): boolean {
    let go = 0;
    for (const peerId of this.connectedPeers) {
      const vote = this.peerIdToVote.get(peerId) ?? null;
      if (vote === "no-go") return false;
      if (vote === "go") go++;
    }
    return go > 0;
  }

  private maybeStartCountdown(): void {
    if (this.launched || this.committed) return;
    if (this.countdown) return;
    if (!this.pollIsGo()) return;
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
    this.committed = true;
    // T-0 commit tone. Fired here (not in CountdownTone) because the
    // component unmounts the instant the countdown clears, so a 100ms tick
    // can't reliably observe secondsLeft === 0. This is the success path
    // (vs. cancelCountdownIfRunning), so it only chimes on a real T-0.
    // Internally gated by isSoundEnabled(); main-only since this service
    // is instantiated only on MainScreen.
    playCountdownTone(true);
    if (this.config.triggerStageAtZero) {
      void this.dispatchCommand("vessel.control.stage", null).then(
        (refusal) => {
          if (refusal === undefined) return;
          logger.warn(`[GoNoGoHost] T-0 stage not sent: ${refusal}`);
          this.committed = false;
        },
      );
    }
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
