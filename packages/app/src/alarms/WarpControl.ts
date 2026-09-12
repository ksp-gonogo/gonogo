import { logger } from "@ksp-gonogo/logger";
import { dispatchActiveCommandTopic } from "@ksp-gonogo/sitrep-client";
import type { AlarmStateMachine } from "./AlarmStateMachine";
import type { Alarm, AlarmWarpState } from "./types";
import type { WarpRateTable } from "./WarpRateTable";

/**
 * The fastest rate to run at when there is no arrival time to plan against:
 * an alarm that is eligible but not yet trackable, or a threshold the
 * simulation cannot model.
 *
 * A RATE, where this used to be warp index 4. The index was only ever shorthand
 * for "100x on stock's ladder", and an install that republishes the ladder
 * makes the shorthand a different number: rung 4 is 10000x on the deck's RSS/RO
 * table. Naming the rate says the same thing on every install, and picks rung 4
 * on stock exactly as before.
 */
const UNPLANNABLE_MAX_RATE = 100;
const WARP_COMMAND_COOLDOWN_MS = 1_500;

export interface WarpControlContext {
  /** Current observed warp index, used to skip redundant commands. */
  getObservedIndex(): number;
  /**
   * What the install's warp rungs actually run at, so the ladder plans against
   * this game rather than stock's table. Read through the context for the same
   * reason the clock and the light-time are: the controller holds no telemetry
   * reach of its own.
   */
  getRateTable(): WarpRateTable;
  /** Stamp called whenever WarpControl issues a warp command, lets the
   *  observer suppress the unscheduled-warp detector for this change. */
  registerOwnWarpIntent(): void;
  /**
   * One-way light time to the craft, seconds, or 0 where there is none.
   *
   * Injected rather than read here so the controller stays a plain class with
   * no telemetry reach of its own, the same way it takes its clock.
   */
  getOwltSeconds(): number;
}

export interface WarpToTarget {
  alarmId: string;
  targetIndex: number;
  /**
   * What that rung runs at on this install, or null while nothing has said.
   *
   * Carried on the snapshot rather than left for a reader to look up, so no
   * screen keeps a second copy of the ladder: the banner mirrored stock's table
   * to render this number and told the operator 100x while the game ran at
   * 10000x. Null is the honest answer for the rung the controller is probing,
   * and the banner draws no target rate rather than a guessed one.
   */
  targetRate: number | null;
}

/**
 * Owns the "warp to next alarm" controller and the on-arming step-down.
 * Reads alarm/UT state through `AlarmStateMachine`; mutates only its own
 * session fields and forwards intent stamps to the host.
 */
export class WarpControl {
  private warpToActive = false;
  private warpToAlarmId: string | null = null;
  private warpToTargetIndex = 0;
  private lastStepDownAt = 0;
  private warpSafetyMarginSeconds: number;
  /** The index the last dispatched `time.setWarpIndex` asked for, null before it has asked for anything. */
  private commandedIndex: number | null = null;
  /** The reading that was current when that command went out, so its arrival can be recognised. */
  private observedAtCommand: number | null = null;

  constructor(
    private readonly stateMachine: AlarmStateMachine,
    private readonly ctx: WarpControlContext,
    private readonly nowMs: () => number,
    initialMarginSeconds: number,
  ) {
    this.warpSafetyMarginSeconds = initialMarginSeconds;
  }

  isActive(): boolean {
    return this.warpToActive;
  }

  snapshot(): WarpToTarget | null {
    if (!this.warpToActive) return null;
    return {
      alarmId: this.warpToAlarmId ?? "",
      targetIndex: this.warpToTargetIndex,
      targetRate:
        this.ctx.getRateTable().rateAt(this.warpToTargetIndex) ?? null,
    };
  }

  getMarginSeconds(): number {
    return this.warpSafetyMarginSeconds;
  }

  setMarginSeconds(seconds: number): void {
    this.warpSafetyMarginSeconds = seconds;
  }

  /**
   * The light-time, when it is the thing actually deciding the ladder, and
   * `undefined` when the operator's own setting still is.
   *
   * Only the overriding case, because the banner's job is to explain a control
   * that is not in force: reporting the light-time while the setting is larger
   * would put a number on screen that changes nothing.
   */
  getOverridingOwltSeconds(): number | undefined {
    const effective = this.effectiveMarginSeconds();
    return effective > this.warpSafetyMarginSeconds ? effective : undefined;
  }

  /** Begin a warp-to session. Returns true if a session actually started. */
  begin(): boolean {
    if (this.stateMachine.findEligiblePendingAlarm() === null) return false;
    this.endSession();
    this.warpToActive = true;
    this.ctx.registerOwnWarpIntent();
    return true;
  }

  /**
   * End the session because the game's warp was stopped by something else, and
   * issue NO warp command on the way out.
   *
   * The twin of the unrequested-stop branch in `reconcile`, for the case where
   * the controller is TOLD rather than left to observe it. A SCET alarm firing
   * on the mod is exactly that: the warp is already at zero, and the reading
   * that proves it is one light-time away, so a session left running would keep
   * claiming on screen to be warping towards something for the whole of it.
   *
   * Not `cancel`, deliberately. Cancelling commands warp to zero, and a second
   * command for state that is already there is a second authority for it.
   */
  endOnExternalStop(): boolean {
    if (!this.warpToActive) return false;
    this.endSession();
    return true;
  }

  /** End the session and drop warp to 1×. */
  cancel(): boolean {
    if (!this.warpToActive) return false;
    this.endSession();
    this.commandWarp(0);
    return true;
  }

  /**
   * Per-tick reconciliation for the warp-to session. Returns true if any
   * warp-to-related state changed (alarm id retarget or target index
   * change), so the host can decide whether to re-emit.
   */
  reconcile(observedUT: number | null): void {
    if (!this.warpToActive) return;
    if (observedUT === null) return;
    const observedIndex = this.ctx.getObservedIndex();
    const stale = this.readingPredatesLastCommand(observedIndex);

    /*
     * A stop the controller did not ask for ends the session. The game halts
     * warp for its own reasons (a SCET alarm on the mod, the operator at the
     * keyboard, KSP itself), and the controller's job is to stop driving, not
     * to argue: reconciling against that reading computes a target above zero
     * and warps straight back up, undoing the stop from the operator's screen.
     *
     * No `commandWarp(0)` on the way out. The warp is already stopped, so a
     * second command would be a second authority for one piece of state.
     */
    if (!stale && observedIndex === 0 && this.warpToTargetIndex > 0) {
      this.endSession();
      return;
    }

    /*
     * What the game's warp index is believed to be right now. While the
     * reading still predates the last command, that is the index the command
     * asked for rather than the reading: at a non-zero delay `time.warp` is a
     * light-time behind, and comparing a fresh target against a stale reading
     * re-dispatches the same command on every tick for the whole light-time.
     */
    const currentIndex = stale
      ? (this.commandedIndex as number)
      : observedIndex;

    const target = this.stateMachine.findClosestPendingTrackableAlarm();
    if (target === null) {
      const eligible = this.stateMachine.findEligiblePendingAlarm();
      if (eligible === null) {
        this.endSession();
        return;
      }
      this.warpToAlarmId = eligible.id;
      const targetIndex = this.ctx
        .getRateTable()
        .chooseIndex(UNPLANNABLE_MAX_RATE);
      this.warpToTargetIndex = targetIndex;
      if (targetIndex !== currentIndex) {
        this.ctx.registerOwnWarpIntent();
        this.commandWarp(targetIndex);
      }
      return;
    }
    this.warpToAlarmId = target.alarm.id;
    const targetIndex = this.computeWarpToIndex(
      target.remainingGameSeconds,
      target.alarm,
    );
    this.warpToTargetIndex = targetIndex;
    if (targetIndex === currentIndex) return;
    this.ctx.registerOwnWarpIntent();
    this.commandWarp(targetIndex);
  }

  /**
   * Whether the observed warp index is still the one from BEFORE the last
   * command this controller sent.
   *
   * True only while the reading is unchanged since the dispatch and has not
   * reached the commanded value. Any change in the reading is a new fact and
   * ends the blind window, whether or not the game settled where it was asked
   * to, so a clamped or refused command cannot strand the controller.
   */
  private readingPredatesLastCommand(observedIndex: number): boolean {
    if (this.commandedIndex === null) return false;
    if (observedIndex === this.commandedIndex) return false;
    return observedIndex === this.observedAtCommand;
  }

  /** Clear the session without touching the game's warp. */
  private endSession(): void {
    this.warpToActive = false;
    this.warpToAlarmId = null;
    this.warpToTargetIndex = 0;
    this.commandedIndex = null;
    this.observedAtCommand = null;
  }

  /** Drop warp to 0× when an alarm transitions to arming/firing.
   *  Throttled so a sustained arming state doesn't flood KSP. */
  stepWarpDown(): void {
    const now = this.nowMs();
    if (now - this.lastStepDownAt < WARP_COMMAND_COOLDOWN_MS) return;
    this.lastStepDownAt = now;
    this.commandWarp(0);
  }

  /**
   * The margin actually applied: the operator's setting, or the one-way light
   * time when that is longer.
   *
   * The setting is a REAL-TIME buffer and knows nothing about delay, so on a
   * craft four minutes away a 10-second margin let the ladder run until the
   * alarm was ten seconds off on the VIEW clock, by which time the craft had
   * been past the event for most of a light-time. A warp window cannot be
   * aborted from inside, so the pessimistic side is the only safe side and the
   * light-time is the size of the pessimism.
   *
   * `max` rather than a sum: the margin and the light-time are two answers to
   * the same question (how much room to leave), not two costs to add up, and a
   * LAN session keeps exactly the behaviour it had.
   */
  private effectiveMarginSeconds(): number {
    const owlt = this.ctx.getOwltSeconds();
    const safeOwlt = Number.isFinite(owlt) && owlt > 0 ? owlt : 0;
    return Math.max(this.warpSafetyMarginSeconds, safeOwlt);
  }

  /**
   * The rung to ask for, from the rate the margin allows and what the install
   * says its rungs run at.
   *
   * The ceiling is expressed as a RATE the whole way down. Picking a rung by
   * looking a rate up in a table this client wrote down itself is the defect
   * being fixed: the table belongs to the install, and only the install (or the
   * game's own behaviour, watched) can say what a rung means.
   */
  private computeWarpToIndex(
    remainingGameSeconds: number,
    target: Alarm,
  ): number {
    if (remainingGameSeconds <= 0) return 0;
    const marginRate = remainingGameSeconds / this.effectiveMarginSeconds();
    const maxRate = this.stateMachine.hasUnmodelableThresholdOther(target)
      ? Math.min(marginRate, UNPLANNABLE_MAX_RATE)
      : marginRate;
    return this.ctx.getRateTable().chooseIndex(maxRate);
  }

  /**
   * Dispatches `time.setWarpIndex` through the stream, a command every
   * production `TelemetryProvider` mount carries. The index goes as an
   * argument rather than formatted into a key for something downstream to
   * parse back out.
   */
  private commandWarp(index: number): void {
    const outcome = dispatchActiveCommandTopic("time.setWarpIndex", { index });
    if (!outcome.routed) {
      logger.warn("alarm-host: warp command not routed", { index });
      return;
    }
    /* Only once it is actually on the wire: an unrouted command never moves the
       game's warp, so treating the reading as stale after one would leave the
       controller waiting for an arrival that cannot come. */
    this.observedAtCommand = this.ctx.getObservedIndex();
    this.commandedIndex = index;
    void outcome.settled;
  }
}

export type { AlarmWarpState };
