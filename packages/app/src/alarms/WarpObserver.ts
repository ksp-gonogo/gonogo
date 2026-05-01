import type { TelemetryReader } from "./AlarmStateMachine";
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
    private readonly telemetry: TelemetryReader | null,
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
    const index =
      this.readTelemetryNumber("t.timeWarp") ??
      this.readTelemetryNumber("t.currentRateIndex");
    const rate = this.readTelemetryNumber("t.currentRate");
    const rawMode = this.telemetry?.getLatestValue("t.warpMode");
    const mode: AlarmWarpState["mode"] =
      rawMode === "HIGH" || rawMode === "LOW" ? rawMode : "UNKNOWN";
    this.observedWarp = {
      index: index ?? this.observedWarp.index,
      rate: rate ?? this.observedWarp.rate,
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

  private readTelemetryNumber(key: string): number | null {
    const v = this.telemetry?.getLatestValue(key);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
}
