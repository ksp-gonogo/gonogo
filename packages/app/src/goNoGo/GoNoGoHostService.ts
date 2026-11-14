/**
 * The host's GO/NO-GO polls and the post-launch abort.
 *
 * One poll per command centre: the mission-control screens standing at a
 * centre vote in its poll, and a pilot votes in none. Each poll has its own
 * countdown, and when it passes, its T-0 action goes out as a command from its
 * centre. Tracks each peer's name, seat, centre and vote, the launch state (the
 * mission elapsed time crossing 0) and who aborted.
 *
 * Subscribable: exposes a shallow snapshot of the poll at the host screen's own
 * centre; emits on any state change.
 */

import { logger } from "@ksp-gonogo/logger";
import type {
  DispatchCommandRefusal,
  TelemetryClient,
} from "@ksp-gonogo/sitrep-client";
import {
  dispatchActiveCommandTopic,
  getActiveTimelineEpoch,
  getVesselIdentity,
  getViewUt,
  onActiveTimelineFrame,
} from "@ksp-gonogo/sitrep-client";
import { Situation, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import type { Seat } from "@ksp-gonogo/sitrep-sdk/spine";
import { commandRefusalSentence } from "@ksp-gonogo/ui-kit";
import { dispatchActionGroup } from "../dispatchActionGroup";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { playAbortTone, playCountdownTone } from "../sound";
import type { CountdownHold, GoNoGoNotice } from "./notice";
import { DEFAULT_ON_GO, ON_GO_NONE } from "./onGo";

/** The slice of the peer host this aggregator reads: the lifecycle subscriptions, where each peer stands, and the sends it makes. */
type GoNoGoHost = Pick<
  PeerHostService,
  | "onPeerConnect"
  | "onPeerDisconnect"
  | "onStationInfo"
  | "onGonogoVote"
  | "onGonogoAbort"
  | "broadcast"
  | "sendToPeer"
> &
  Partial<Pick<PeerHostService, "centreOf" | "onCentresChanged">>;

/**
 * Where the host's polls send their commands from and which poll its own
 * screen shows.
 */
export interface GoNoGoPlaces {
  /** The centre the host screen stands at, or `null` for a screen that stands at none, such as a pilot's. */
  hostCentre(): string | null;
  /** A client that sends a command from `centre`, with that centre's delay. */
  commandFrom(centre: string): TelemetryClient | undefined;
}

const NO_PLACES: GoNoGoPlaces = {
  hostCentre: () => "",
  commandFrom: () => undefined,
};

/** The state of one command centre's poll. */
interface CentrePoll {
  countdown: { t0Ms: number; timer: ReturnType<typeof setTimeout> } | null;
  notice: GoNoGoNotice | null;
  /**
   * Set when a countdown reaches T-0, and what keeps a second one from
   * starting. `launched` cannot do that job: it turns true only when the
   * craft's own mission time arrives, which under signal delay is later than
   * T-0, and a vote repeated in between would count down and stage again.
   * Cleared when the poll stops passing, when the craft is back on the pad, or
   * when the stage was not taken.
   */
  committed: boolean;
}

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
  /** The command centre whose poll this is, `""` before the host screen knows where it stands, `null` when it stands at none. */
  centre: string | null;
  stations: StationSnapshot[];
  countdown: { t0Ms: number } | null;
  launched: boolean;
  /** The operator reset the poll after launch, so votes and countdowns run again until the craft is back on the pad. */
  reopened: boolean;
  abort: { peerId: string; stationName: string; at: number } | null;
  /** What the poll last did, until the next countdown starts or the poll is reset. */
  notice: GoNoGoNotice | null;
  config: GoNoGoConfig;
}

export interface GoNoGoConfig {
  countdownLengthMs: number;
  /** What fires at T-0: an action group id as `actionGroupIdOf` spells it, or {@link ON_GO_NONE}. */
  onGo: string;
  /** The name `onGo` is shown under, on this screen and every station, or `null` for nothing. */
  onGoLabel: string | null;
}

export const DEFAULT_GONOGO_CONFIG: GoNoGoConfig = {
  countdownLengthMs: 10_000,
  onGo: DEFAULT_ON_GO,
  onGoLabel: "Stage",
};

type Listener = () => void;

/**
 * The sentence saying why `action` was not sent: the refusal wording the
 * controls use when the game gave a typed reason, otherwise the message the
 * dispatch failed with.
 */
function refusalWhy(
  action: string,
  message: string,
  refusal: DispatchCommandRefusal | undefined,
): string {
  if (refusal?.errorCode) {
    return commandRefusalSentence({
      errorCode: refusal.errorCode,
      reason: refusal.reason,
      detail: refusal.detail,
      label: action,
    });
  }
  return `${action} not sent: ${message}`;
}

/** A countdown at the host screen's own centre starting, or finishing as go or as aborted. */
export type CountdownEvent =
  | { type: "start"; lengthMs: number }
  | { type: "end"; how: "go" | "aborted" };

export class GoNoGoHostService {
  private peerIdToName = new Map<string, string>();
  private peerIdToVote = new Map<string, Vote>();
  private peerIdToSeat = new Map<string, Seat | undefined>();
  /** The centre a local screen said it stands at; a remote station's comes from its session. */
  private peerIdToCentre = new Map<string, string>();
  private connectedPeers = new Set<string>();
  private polls = new Map<string, CentrePoll>();
  private launched = false;
  private reopened = false;
  private abortInFlight = false;
  /** The epoch each store showed at its last frame, so a frame can tell a new timeline from one more frame of the same. */
  private epochs = new WeakMap<object, number>();
  /** Counts flights started over, so a T-0 outcome that settles after a revert is not shown against the new flight. */
  private flightSerial = 0;
  private abort: { peerId: string; stationName: string; at: number } | null =
    null;
  private config: GoNoGoConfig = { ...DEFAULT_GONOGO_CONFIG };
  private listeners = new Set<Listener>();
  private countdownListeners = new Set<(event: CountdownEvent) => void>();
  private unsubs: Array<() => void> = [];

  constructor(
    private host: GoNoGoHost,
    private places: GoNoGoPlaces = NO_PLACES,
  ) {
    this.unsubs.push(
      host.onPeerConnect((peerId) => {
        // A screen that has just joined has no vote, and a screen with no vote is not in the poll: its first vote decides what it does to a countdown.
        this.connectedPeers.add(peerId);
        this.host.sendToPeer(peerId, this.onGoMessage());
        this.tellJoiner(peerId);
        this.emit();
      }),
    );

    this.unsubs.push(
      host.onPeerDisconnect((peerId) => {
        const centre = this.voterCentre(peerId);
        this.connectedPeers.delete(peerId);
        const stationName = this.peerIdToName.get(peerId) ?? "Unknown";
        this.peerIdToName.delete(peerId);
        this.peerIdToSeat.delete(peerId);
        this.peerIdToCentre.delete(peerId);
        const leftVote = this.peerIdToVote.get(peerId) ?? null;
        const hadVote = leftVote !== null;
        this.peerIdToVote.delete(peerId);
        // A screen with no vote was not in the poll, so its leaving changes nothing for a countdown.
        if (centre !== null && (hadVote || !this.pollIsGo(centre))) {
          this.cancelCountdownIfRunning(centre, "station disconnected", {
            cause: "dropped",
            station: stationName,
          });
        }
        // The only NO-GO leaving can leave the standing GO votes passing.
        if (centre !== null && leftVote === "no-go") {
          this.maybeStartCountdown(centre);
        }
        this.emit();
      }),
    );

    this.unsubs.push(
      host.onStationInfo((peerId, info) => {
        this.peerIdToName.set(peerId, info.name);
        this.peerIdToSeat.set(peerId, info.seat);
        if (info.centre) this.peerIdToCentre.set(peerId, info.centre);
        else this.peerIdToCentre.delete(peerId);
        this.recheckCountdowns();
        this.emit();
      }),
    );

    if (host.onCentresChanged) {
      this.unsubs.push(
        host.onCentresChanged(() => {
          this.recheckCountdowns();
          this.emit();
        }),
      );
    }

    this.unsubs.push(
      host.onGonogoVote((peerId, status, epoch) => {
        if (status === "go" && this.castBeforeThisTimeline(epoch)) {
          this.peerIdToVote.set(peerId, "no-go");
          this.host.sendToPeer(peerId, {
            type: "gonogo-reset",
            reopened: this.reopened,
          });
          this.emit();
          return;
        }
        this.peerIdToVote.set(peerId, status);
        const centre = this.voterCentre(peerId);
        if (centre === null) return;
        if (this.pollIsGo(centre)) {
          this.maybeStartCountdown(centre);
        } else {
          this.pollAt(centre).committed = false;
          this.cancelCountdownIfRunning(
            centre,
            status === null
              ? "the last GO vote was withdrawn"
              : `vote flipped to ${status}`,
            {
              cause: status === null ? "withdrawn" : "no-go",
              station: this.peerIdToName.get(peerId) ?? "Unknown",
            },
          );
        }
        this.emit();
      }),
    );

    this.unsubs.push(
      host.onGonogoAbort((peerId, epoch) => {
        if (!this.launched) return;
        // A station that was away during a load resends the abort it pressed on the flight the load left.
        if (this.castBeforeThisTimeline(epoch)) {
          this.host.sendToPeer(peerId, {
            type: "gonogo-reset",
            reopened: this.reopened,
          });
          return;
        }
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
        this.noteTimeline();
        if (getVesselIdentity()?.situation === Situation.PreLaunch) {
          this.handleMissionTime(value("s", 0));
          return;
        }
        const met = missionElapsed();
        if (met != null) this.handleMissionTime(met);
      }),
    );
  }

  /**
   * The centre whose poll `peerId` votes in, or `null` for a pilot, who votes
   * in none. A local screen states its own centre; a remote station stands
   * where its session reads from. `""` while neither is known.
   */
  private voterCentre(peerId: string): string | null {
    if (this.peerIdToSeat.get(peerId) === "pilot") return null;
    return (
      this.peerIdToCentre.get(peerId) ?? this.host.centreOf?.(peerId) ?? ""
    );
  }

  private pollAt(centre: string): CentrePoll {
    let poll = this.polls.get(centre);
    if (!poll) {
      poll = { countdown: null, notice: null, committed: false };
      this.polls.set(centre, poll);
    }
    return poll;
  }

  /** The connected peers voting in `centre`'s poll. */
  private votersAt(centre: string): string[] {
    return [...this.connectedPeers].filter(
      (peerId) => this.voterCentre(peerId) === centre,
    );
  }

  /** Send `msg` to the screens voting in `centre`'s poll and to nobody else. */
  private tellCentre(centre: string, msg: PeerMessage): void {
    for (const peerId of this.votersAt(centre)) {
      this.host.sendToPeer(peerId, msg);
    }
  }

  /** Bring a screen that has just joined up to date with its centre's poll. */
  private tellJoiner(peerId: string): void {
    const centre = this.voterCentre(peerId);
    const countdown =
      centre === null ? null : (this.polls.get(centre)?.countdown ?? null);
    if (countdown) {
      this.host.sendToPeer(peerId, {
        type: "gonogo-countdown-start",
        remainingMs: Math.max(0, countdown.t0Ms - Date.now()),
      });
    }
    if (this.reopened) {
      this.host.sendToPeer(peerId, { type: "gonogo-reset", reopened: true });
    }
  }

  /** Hold every countdown whose poll no longer passes, after a screen moved centre. */
  private recheckCountdowns(): void {
    for (const [centre, poll] of this.polls) {
      if (!poll.countdown || this.pollIsGo(centre)) continue;
      this.cancelCountdownIfRunning(centre, "a station left this centre", {
        cause: "dropped",
      });
    }
  }

  /** Whether a vote or abort cast at timeline `epoch` came from before the timeline the game is on now. */
  private castBeforeThisTimeline(epoch: number | undefined): boolean {
    if (epoch === undefined) return false;
    const now = getActiveTimelineEpoch();
    return now !== undefined && epoch < now.epoch;
  }

  /**
   * Starts every poll over when the game starts a new timeline (a revert, a
   * quickload, another save). The epoch is remembered per store: a replay
   * mounts a store with an epoch of its own, so swapping between it and the
   * live stream is no new timeline, and a revert that happens while a replay is
   * showing is still seen when the live store returns. A store is first
   * compared once it has delivered a sample, because a store that has only
   * just been built reads epoch 0 before the stream's own epoch reaches it.
   */
  private noteTimeline(): void {
    const now = getActiveTimelineEpoch();
    if (!now || getVesselIdentity() === undefined) return;
    const prev = this.epochs.get(now.store);
    this.epochs.set(now.store, now.epoch);
    if (prev !== undefined && now.epoch > prev) this.startOver();
  }

  /**
   * Forgets everything the previous timeline left in the polls (votes, T-0
   * commits, the staging notice and the abort), closes a reopened poll, and
   * tells every station to drop its own vote and banner.
   */
  private startOver(): void {
    for (const [centre, poll] of this.polls) {
      this.cancelCountdownIfRunning(centre, "new flight", { cause: "reset" });
      poll.committed = false;
      poll.notice = null;
    }
    this.peerIdToVote.clear();
    this.abort = null;
    this.reopened = false;
    this.flightSerial++;
    this.host.broadcast({ type: "gonogo-reset", reopened: false });
    this.emit();
  }

  /** The launch-state transition for one mission elapsed time. */
  private handleMissionTime(missionTime: Value<"s">): void {
    const wasLaunched = this.launched;
    this.launched = missionTime.isPositive();
    if (wasLaunched && !this.launched) {
      // Back on the pad after a flight: a new flight that the game did not announce as a new timeline (a recovery, then a launch from the hangar).
      this.startOver();
    }
    if (this.launched && !wasLaunched && !this.reopened) {
      // The stage has taken effect: "sent" is no longer news.
      for (const poll of this.polls.values()) {
        if (poll.notice?.kind === "outcome") poll.notice = null;
      }
    }
    if (this.launched && !this.reopened) {
      for (const centre of this.polls.keys()) {
        this.cancelCountdownIfRunning(centre, "launch detected", {
          cause: "launch",
        });
      }
    }
    if (wasLaunched !== this.launched || wasLaunched) this.emit();
  }

  /**
   * Send the abort and, only once the craft has taken it, record it, sound the
   * alert and tell every station who aborted. An abort that had no stream to
   * travel on, or that the game refused, is recorded nowhere, so the next press
   * from any station sends it again. It leaves from the centre of the screen
   * that pressed it.
   */
  private async sendAbort(peerId: string, stationName: string): Promise<void> {
    this.abortInFlight = true;
    const centre = this.voterCentre(peerId);
    const refused = await this.dispatchCommand(
      "vessel.control.setAbort",
      { enabled: true },
      centre ? this.places.commandFrom(centre) : undefined,
    );
    this.abortInFlight = false;
    if (refused !== undefined) {
      logger.warn(
        `[GoNoGoHost] abort from ${stationName} not sent: ${refused.message}`,
      );
      const why = refusalWhy("Abort", refused.message, refused.refusal);
      if (centre === null) {
        // A pilot votes in no poll, so the refusal goes to the pilot who pressed it.
        this.host.sendToPeer(peerId, {
          type: "gonogo-outcome",
          action: "Abort",
          sent: false,
          why,
        });
      } else {
        this.announceOutcome(centre, "Abort", false, why);
      }
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
    through: TelemetryClient | undefined,
  ): Promise<
    { message: string; refusal?: DispatchCommandRefusal } | undefined
  > {
    const outcome = dispatchActiveCommandTopic(command, args, through);
    if (!outcome.routed) {
      return { message: "no telemetry stream is connected" };
    }
    const refusal = await outcome.settled;
    return refusal ? { message: refusal.message, refusal } : undefined;
  }

  /** Calls `listener` as a countdown at the host screen's own centre starts or finishes. */
  onCountdown(listener: (event: CountdownEvent) => void): () => void {
    this.countdownListeners.add(listener);
    return () => {
      this.countdownListeners.delete(listener);
    };
  }

  private announceCountdown(centre: string, event: CountdownEvent): void {
    if (centre !== this.places.hostCentre()) return;
    for (const listener of [...this.countdownListeners]) listener(event);
  }

  /** The poll at the host screen's own centre, which is the one its header shows. */
  getSnapshot(): GoNoGoSnapshot {
    const centre = this.places.hostCentre();
    const poll = centre === null ? undefined : this.polls.get(centre);
    const stations: StationSnapshot[] = [];
    if (centre !== null) {
      for (const peerId of this.votersAt(centre)) {
        stations.push({
          peerId,
          name: this.peerIdToName.get(peerId) ?? "Unknown",
          status: this.peerIdToVote.get(peerId) ?? null,
        });
      }
    }
    return {
      centre,
      stations,
      countdown: poll?.countdown ? { t0Ms: poll.countdown.t0Ms } : null,
      launched: this.launched,
      reopened: this.reopened,
      abort: this.abort,
      notice: poll?.notice ?? null,
      config: { ...this.config },
    };
  }

  setConfig(partial: Partial<GoNoGoConfig>): void {
    const next = { ...this.config, ...partial };
    if (
      next.countdownLengthMs === this.config.countdownLengthMs &&
      next.onGo === this.config.onGo &&
      next.onGoLabel === this.config.onGoLabel
    ) {
      return;
    }
    const labelChanged = next.onGoLabel !== this.config.onGoLabel;
    this.config = next;
    if (labelChanged) this.host.broadcast(this.onGoMessage());
    this.emit();
  }

  private onGoMessage(): PeerMessage {
    return { type: "gonogo-on-go", label: this.config.onGoLabel };
  }

  /**
   * Start every poll over: cancel the countdowns in flight, forget every vote
   * and the T-0 commits, and tell every station to drop its own vote. After
   * launch this re-opens the polls, so a later event can be polled; the abort
   * and its attribution are untouched.
   */
  reset(): void {
    for (const [centre, poll] of this.polls) {
      poll.notice = null;
      this.cancelCountdownIfRunning(centre, "reset", { cause: "reset" });
      poll.committed = false;
    }
    this.peerIdToVote.clear();
    this.reopened = this.launched;
    this.host.broadcast({ type: "gonogo-reset", reopened: this.reopened });
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Drop every poll: a countdown still running never reaches T-0. */
  dispose(): void {
    for (const poll of this.polls.values()) {
      if (poll.countdown) clearTimeout(poll.countdown.timer);
      poll.countdown = null;
    }
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.listeners.clear();
  }

  /**
   * Whether `centre`'s poll passes: at least one screen voting in it has voted
   * "GO" and none has voted "NO-GO". A screen with no vote is not in the poll,
   * whether it never showed the widget or has removed it, so it neither blocks
   * a countdown nor counts towards one. No votes at all does not pass.
   */
  private pollIsGo(centre: string): boolean {
    let go = 0;
    for (const peerId of this.votersAt(centre)) {
      const vote = this.peerIdToVote.get(peerId) ?? null;
      if (vote === "no-go") return false;
      if (vote === "go") go++;
    }
    return go > 0;
  }

  private maybeStartCountdown(centre: string): void {
    const poll = this.pollAt(centre);
    if ((this.launched && !this.reopened) || poll.committed) return;
    if (poll.countdown) return;
    if (!this.pollIsGo(centre)) return;
    const t0Ms = Date.now() + this.config.countdownLengthMs;
    const timer = setTimeout(() => {
      this.onCountdownReached(centre);
    }, this.config.countdownLengthMs);
    poll.countdown = { t0Ms, timer };
    poll.notice = null;
    this.announceCountdown(centre, {
      type: "start",
      lengthMs: this.config.countdownLengthMs,
    });
    this.tellCentre(centre, {
      type: "gonogo-countdown-start",
      remainingMs: this.config.countdownLengthMs,
    });
  }

  private cancelCountdownIfRunning(
    centre: string,
    reason: string,
    hold: CountdownHold,
  ): void {
    const poll = this.polls.get(centre);
    if (!poll?.countdown) return;
    clearTimeout(poll.countdown.timer);
    poll.countdown = null;
    poll.notice = { kind: "held", ...hold };
    this.tellCentre(centre, { type: "gonogo-countdown-cancel", reason, hold });
    this.announceCountdown(centre, { type: "end", how: "aborted" });
  }

  private onCountdownReached(centre: string): void {
    const poll = this.polls.get(centre);
    if (!poll?.countdown) return;
    poll.countdown = null;
    poll.committed = true;
    this.announceCountdown(centre, { type: "end", how: "go" });
    // The countdown is spent: clear the votes and tell the centre's screens, so none keeps a chip at T-0 or a vote for a poll that has finished.
    for (const peerId of this.votersAt(centre))
      this.peerIdToVote.delete(peerId);
    this.tellCentre(centre, { type: "gonogo-reset", reopened: this.reopened });
    // T-0 commit tone. Fired here (not in CountdownTone) because the
    // component unmounts the instant the countdown clears, so a 100ms tick
    // can't reliably observe secondsLeft === 0. This is the success path
    // (vs. cancelCountdownIfRunning), so it only chimes on a real T-0.
    // Internally gated by isSoundEnabled(); main-only since this service
    // is instantiated only on MainScreen.
    playCountdownTone(true);
    if (this.config.onGo !== ON_GO_NONE) {
      void this.fireOnGo(centre, this.config.onGo);
    } else {
      this.announceOutcome(centre, null, true);
    }
    this.emit();
  }

  /**
   * Fire the chosen action at T-0, through the command the ActionGroup widget
   * sends, from the poll's own centre. An action the craft did not take leaves
   * the countdown restartable.
   */
  private async fireOnGo(centre: string, actionGroupId: string): Promise<void> {
    const flight = this.flightSerial;
    const outcome = dispatchActionGroup(
      actionGroupId,
      centre ? this.places.commandFrom(centre) : undefined,
    );
    const refused = outcome.routed ? await outcome.settled : undefined;
    const refusal = outcome.routed ? refused?.message : outcome.refusal;
    if (flight !== this.flightSerial) return;
    if (refusal !== undefined) {
      logger.warn(`[GoNoGoHost] T-0 action not sent: ${refusal}`);
      this.pollAt(centre).committed = false;
    }
    const why =
      refusal === undefined
        ? undefined
        : refusalWhy(this.config.onGoLabel ?? "T-0 action", refusal, refused);
    this.announceOutcome(
      centre,
      this.config.onGoLabel,
      refusal === undefined,
      why,
    );
  }

  /** Record what T-0 did and tell the centre's screens, so none is left reading a reset as the answer. */
  private announceOutcome(
    centre: string,
    action: string | null,
    sent: boolean,
    why?: string,
  ): void {
    const extra = why === undefined ? {} : { why };
    this.pollAt(centre).notice = { kind: "outcome", action, sent, ...extra };
    this.tellCentre(centre, {
      type: "gonogo-outcome",
      action,
      sent,
      ...extra,
    });
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
