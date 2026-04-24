export type AlarmState =
  /** UT is well in the future, nothing to do. */
  | "pending"
  /** UT is within the lead window — host has stepped warp down. */
  | "arming"
  /** UT has passed — banner shows "FIRED", fade-out in a few seconds. */
  | "firing"
  /** Already-fired, kept briefly for visibility then removed. */
  | "fired";

export interface Alarm {
  id: string;
  /** KSP Universal Time, in seconds. */
  ut: number;
  name: string;
  notes?: string;
  /**
   * Seconds before UT to step warp down. Default 10. Longer values give
   * the operator more time to pre-align; shorter ones minimise real-time
   * waste when timing isn't critical.
   */
  leadSeconds: number;
  state: AlarmState;
  /** Source of the alarm — "main" or a peer id. */
  createdBy: string;
  /** Wall-clock `Date.now()` when created. */
  createdAt: number;
}

export interface AlarmWarpState {
  /** KSP warp-rate index. 0 = realtime. */
  index: number;
  /** Numeric multiplier corresponding to the index. */
  rate: number;
  /** "HIGH" | "LOW" — matches Telemachus's t.warpMode when known. */
  mode: "HIGH" | "LOW" | "UNKNOWN";
}

export interface AlarmSnapshot {
  alarms: Alarm[];
  /**
   * Latest KSP universal time we've observed from Telemachus, seconds.
   * Stations use this to render the T-minus countdown against an
   * authoritative source without subscribing to t.universalTime themselves.
   */
  ut: number | null;
  warp: AlarmWarpState;
  /**
   * Non-null when warp is elevated and no alarm or recent user-initiated
   * warp-change explains it. `detectedAtUT` is the UT at detection, so the
   * banner can age it out. Cleared when warp returns to 0 or the user
   * explicitly acks.
   */
  unscheduledWarp: { index: number; detectedAtUT: number } | null;
}

export const DEFAULT_LEAD_SECONDS = 10;
