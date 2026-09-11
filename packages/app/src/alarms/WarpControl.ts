import { logger } from "@ksp-gonogo/logger";
import { dispatchActiveCommandTopic } from "@ksp-gonogo/sitrep-client";
import type { AlarmStateMachine } from "./AlarmStateMachine";
import type { Alarm, AlarmWarpState } from "./types";

const HIGH_WARP_RATES: readonly number[] = [
  1, 5, 10, 50, 100, 1000, 10000, 100000,
];
const THRESHOLD_PRESENT_MAX_INDEX = 4;
const WARP_COMMAND_COOLDOWN_MS = 1_500;

export interface WarpControlContext {
  /** Current observed warp index, used to skip redundant commands. */
  getObservedIndex(): number;
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
    this.warpToActive = true;
    this.warpToTargetIndex = 0;
    this.ctx.registerOwnWarpIntent();
    return true;
  }

  /** End the session and drop warp to 1×. */
  cancel(): boolean {
    if (!this.warpToActive) return false;
    this.warpToActive = false;
    this.warpToAlarmId = null;
    this.warpToTargetIndex = 0;
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
    const target = this.stateMachine.findClosestPendingTrackableAlarm();
    if (target === null) {
      const eligible = this.stateMachine.findEligiblePendingAlarm();
      if (eligible === null) {
        this.warpToActive = false;
        this.warpToAlarmId = null;
        this.warpToTargetIndex = 0;
        return;
      }
      this.warpToAlarmId = eligible.id;
      const targetIndex = THRESHOLD_PRESENT_MAX_INDEX;
      this.warpToTargetIndex = targetIndex;
      if (targetIndex !== this.ctx.getObservedIndex()) {
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
    if (targetIndex === this.ctx.getObservedIndex()) return;
    this.ctx.registerOwnWarpIntent();
    this.commandWarp(targetIndex);
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

  private computeWarpToIndex(
    remainingGameSeconds: number,
    target: Alarm,
  ): number {
    if (remainingGameSeconds <= 0) return 0;
    const maxRate = remainingGameSeconds / this.effectiveMarginSeconds();
    const cap = this.stateMachine.hasUnmodelableThresholdOther(target)
      ? THRESHOLD_PRESENT_MAX_INDEX
      : HIGH_WARP_RATES.length - 1;
    let chosen = 0;
    for (let i = cap; i >= 0; i--) {
      if (HIGH_WARP_RATES[i] <= maxRate) {
        chosen = i;
        break;
      }
    }
    return chosen;
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
    void outcome.settled;
  }
}

export type { AlarmWarpState };
