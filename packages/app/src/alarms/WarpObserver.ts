import { getWarpState } from "@ksp-gonogo/sitrep-client";
import { WarpMode } from "@ksp-gonogo/sitrep-sdk";
import type { Alarm, AlarmSnapshot, AlarmWarpState } from "./types";

/** Grace window around a station-initiated warp intent — any observed
 *  warp change within this window is attributed to the station. */
const WARP_INTENT_WINDOW_MS = 2_000;

export interface WarpObserverContext {
  getAlarms(): readonly Alarm[];
  getObservedUT(): number | null;
  isWarpToActive(): boolean;
}

/**
 * Reads warp telemetry into a normalised `AlarmWarpState`, and decides
 * whether an elevated warp rate is "unscheduled" (no alarm or station
 * action explains it). Owns the intent-window timestamp so the host
 * doesn't have to special-case its own warp-to commands.
 *
 * Warp state comes off the stream via the non-hook `getWarpState()`
 * accessor (`@ksp-gonogo/sitrep-client`, the whole `time.warp` `WarpState`
 * record) rather than the legacy `t.timeWarp`/`t.currentRateIndex`/
 * `t.currentRate`/`t.warpMode` per-field reads this used to make against the
 * `"data"` `DataSource`.
 */
export class WarpObserver {
  private observedWarp: AlarmWarpState = {
    index: 0,
    rate: 1,
    mode: "UNKNOWN",
  };
  private unscheduledWarp: AlarmSnapshot["unscheduledWarp"] = null;
  private lastIntentAt: number | null = null;

  constructor(
    private readonly ctx: WarpObserverContext,
    private readonly nowMs: () => number,
  ) {}

  getWarp(): AlarmWarpState {
    return this.observedWarp;
  }

  getUnscheduled(): AlarmSnapshot["unscheduledWarp"] {
    return this.unscheduledWarp;
  }

  registerIntent(): void {
    this.lastIntentAt = this.nowMs();
  }

  acknowledgeUnscheduled(): boolean {
    if (!this.unscheduledWarp) return false;
    this.unscheduledWarp = null;
    return true;
  }

  observeWarp(): void {
    const warp = getWarpState();
    const mode: AlarmWarpState["mode"] =
      warp?.warpMode === WarpMode.High
        ? "HIGH"
        : warp?.warpMode === WarpMode.Low
          ? "LOW"
          : "UNKNOWN";
    this.observedWarp = {
      index: warp?.warpRateIndex ?? this.observedWarp.index,
      rate: warp?.warpRate ?? this.observedWarp.rate,
      mode,
    };
  }

  detectUnscheduled(): void {
    const elevated = this.observedWarp.index > 0 || this.observedWarp.rate > 1;
    if (!elevated) {
      this.unscheduledWarp = null;
      return;
    }

    const ut = this.ctx.getObservedUT();
    if (ut === null) return;

    const anyArming = this.ctx
      .getAlarms()
      .some((a) => a.state === "arming" || a.state === "firing");
    if (anyArming) {
      this.unscheduledWarp = null;
      return;
    }

    if (this.ctx.isWarpToActive()) {
      this.unscheduledWarp = null;
      return;
    }

    const now = this.nowMs();
    if (
      this.lastIntentAt !== null &&
      now - this.lastIntentAt < WARP_INTENT_WINDOW_MS
    ) {
      return;
    }

    if (!this.unscheduledWarp) {
      this.unscheduledWarp = {
        index: this.observedWarp.index,
        detectedAtUT: ut,
      };
    } else {
      this.unscheduledWarp.index = this.observedWarp.index;
    }
  }
}
