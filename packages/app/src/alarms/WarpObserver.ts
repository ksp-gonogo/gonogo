import { getWarpState } from "@ksp-gonogo/sitrep-client";
import { WarpMode } from "@ksp-gonogo/sitrep-sdk";
import type { Alarm, AlarmSnapshot, AlarmWarpState } from "./types";
import { WarpRateTable } from "./WarpRateTable";

/** Grace window around a station-initiated warp intent, any observed
 *  warp change within this window is attributed to the station. */
const WARP_INTENT_WINDOW_MS = 2_000;

/** How many rate changes `rateBefore` can look back across. */
const RATE_HISTORY_LIMIT = 256;

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
 * accessor (`@ksp-gonogo/sitrep-client`), which carries the whole `time.warp`
 * `WarpState` record in one read.
 */
export class WarpObserver {
  private observedWarp: AlarmWarpState = {
    index: 0,
    rate: 1,
    mode: "UNKNOWN",
  };
  private unscheduledWarp: AlarmSnapshot["unscheduledWarp"] = null;
  private lastIntentAt: number | null = null;
  private readonly rateTable = new WarpRateTable();
  /** Each change in the reported rate, keyed by the view UT it was read at. */
  private readonly rateChanges: { ut: number; rate: number }[] = [];

  constructor(
    private readonly ctx: WarpObserverContext,
    private readonly nowMs: () => number,
  ) {}

  getWarp(): AlarmWarpState {
    return this.observedWarp;
  }

  /**
   * What this install's warp rungs run at, as it has been learned so far.
   *
   * Kept here rather than in `WarpControl` because this is the class that reads
   * `time.warp`, and the table is learned from every reading whether or not a
   * warp-to session is running: knowledge a session would otherwise have to
   * re-acquire, one rung per tick, every time one starts.
   */
  getRateTable(): WarpRateTable {
    return this.rateTable;
  }

  /**
   * The rate the game reported as in force just before `ut`, or `null` when no
   * reading from before it was seen.
   *
   * Strictly before, because a fire is the instant warp is stopped: the mod
   * drops warp as it fires and the client steps down as it does, so the
   * reading taken AT a fire says 1x whatever the craft was doing on the way in.
   * `null` rather than 1 when nothing was read, so a session that never
   * received `time.warp` cannot pass for one that ran at 1x.
   */
  rateBefore(ut: number): number | null {
    for (let i = this.rateChanges.length - 1; i >= 0; i--) {
      if (this.rateChanges[i].ut < ut) return this.rateChanges[i].rate;
    }
    return null;
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
    // Unwrapped here rather than carried: `AlarmWarpState` is part of the
    // snapshot the host broadcasts to stations over PeerJS, and a `Value`
    // crossing that channel arrives as a bare object with no prototype and
    // so no methods on it. The rate is a dimensionless multiplier read as
    // "10x", which is a number the whole way down.
    const reportedRate = warp?.warpRate?.magnitude;
    const reportedIndex = warp?.warpRateIndex;
    this.observedWarp = {
      index: reportedIndex ?? this.observedWarp.index,
      rate: reportedRate ?? this.observedWarp.rate,
      mode,
    };

    this.rateTable.setPublished(warp?.warpRates);

    /*
     * Only when the SAME reading carried both, never the merged state above:
     * that falls each field back to its last value, so a reading missing the
     * rate would pair a fresh rung with the rate of the one before it and write
     * down a rung meaning it has never seen.
     */
    if (typeof reportedIndex === "number" && typeof reportedRate === "number") {
      this.rateTable.observe(reportedIndex, reportedRate);
    }

    const ut = this.ctx.getObservedUT();
    if (typeof reportedRate === "number" && ut !== null) {
      this.recordRate(ut, reportedRate);
    }
  }

  private recordRate(ut: number, rate: number): void {
    // A view clock that went backwards (a rewind or a revert) means what was
    // read after this instant no longer happened.
    while ((this.rateChanges.at(-1)?.ut ?? Number.NEGATIVE_INFINITY) > ut) {
      this.rateChanges.pop();
    }
    const last = this.rateChanges.at(-1);
    if (last?.rate === rate) return;
    if (last?.ut === ut) {
      last.rate = rate;
      return;
    }
    this.rateChanges.push({ ut, rate });
    if (this.rateChanges.length > RATE_HISTORY_LIMIT) this.rateChanges.shift();
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
