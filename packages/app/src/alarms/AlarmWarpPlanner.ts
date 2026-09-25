import type { Alarm } from "./types";

/**
 * A one-way light time to be subtracted: a non-finite or negative reading
 * is no light time rather than a negative one, which would push a SCET instant
 * further away instead of closer.
 */
function safeOwltSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/**
 * The warp-to ladder's planner: the two queries `WarpControl` asks
 * (`findClosestPendingTrackableAlarm`, `findEligiblePendingAlarm`).
 *
 * Only a time alarm is a target. Every other kind is judged by the simulation
 * against readings this screen holds a light-time late, and the simulation
 * stops the warp itself when one comes due, so a ladder planned toward one
 * from here would be a second authority arriving late.
 *
 * The host owns the alarm array and `observedUT`; this module reads them
 * through getter callbacks so it never holds stale copies.
 */
export class AlarmWarpPlanner {
  constructor(
    private readonly getAlarms: () => readonly Alarm[],
    private readonly getObservedUT: () => number | null,
    /**
     * One-way light time to the craft, seconds, or 0 where there is none.
     *
     * A time alarm's instant is the game's own universal time while every
     * countdown planned here is on the view clock, so the two are a light-time
     * apart and a warp-to ladder that did not close the gap would plan against
     * an instant that is not the one the mod will stop it at. Defaulted so a
     * caller with no vantage of its own needs no argument.
     */
    private readonly getOwltSeconds: () => number = () => 0,
  ) {}

  /** The closest pending time alarm, and the view-clock seconds left before its warp stop. */
  findClosestPendingTrackableAlarm(): {
    alarm: Alarm;
    remainingGameSeconds: number;
  } | null {
    const ut = this.getObservedUT();
    if (ut === null) return null;
    let best: { alarm: Alarm; remaining: number } | null = null;
    for (const a of this.getAlarms()) {
      if (a.state !== "pending" || a.trigger.kind !== "time") continue;
      /* The light-time always comes off `ut`, the view clock: the mod stops the
         warp when the GAME reaches `ut - lead`, which the operator's screen
         reaches one light-time later. */
      const vantageOffset = safeOwltSeconds(this.getOwltSeconds());
      const remaining =
        a.trigger.ut - vantageOffset - a.trigger.leadSeconds - ut;
      if (remaining <= 0) continue;
      if (!best || remaining < best.remaining) {
        best = { alarm: a, remaining };
      }
    }
    return best
      ? { alarm: best.alarm, remainingGameSeconds: best.remaining }
      : null;
  }

  /** Any pending time alarm, which a warp-to session holds open for. */
  findEligiblePendingAlarm(): Alarm | null {
    return (
      this.getAlarms().find(
        (a) => a.state === "pending" && a.trigger.kind === "time",
      ) ?? null
    );
  }
}
