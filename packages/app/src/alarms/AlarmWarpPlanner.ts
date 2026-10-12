import type { Alarm } from "./types";

/**
 * A one-way signal delay to be subtracted: a non-finite or negative reading
 * is no signal delay rather than a negative one, which would push a SCET instant
 * further away instead of closer.
 */
function safeOwltSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/**
 * The instant the ladder plans toward for an alarm and the lead it steps down
 * by, or null for an alarm that is no target: a time alarm's own instant, or the
 * instant the simulation last read for one that follows a Topic.
 */
function targetInstant(a: Alarm): { ut: number; leadSeconds: number } | null {
  if (a.trigger.kind === "time") {
    return { ut: a.trigger.ut, leadSeconds: a.trigger.leadSeconds };
  }
  if (a.trigger.kind === "instant" && a.followedUT !== undefined) {
    return { ut: a.followedUT, leadSeconds: a.trigger.leadSeconds };
  }
  return null;
}

/**
 * The warp-to ladder's planner: the two queries `WarpControl` asks
 * (`findClosestPendingTrackableAlarm`, `findEligiblePendingAlarm`).
 *
 * A time alarm is a target, and so is an alarm that follows a Topic's instant
 * once the simulation has read one, at the instant it last read. Every other
 * kind is judged by the simulation against readings this screen holds a signal
 * delay late, and the simulation stops the warp itself when one comes due, so a
 * ladder planned toward one from here would be a second authority arriving
 * late.
 *
 * The host owns the alarm array and `observedUT`; this module reads them
 * through getter callbacks so it never holds stale copies.
 */
export class AlarmWarpPlanner {
  constructor(
    private readonly getAlarms: () => readonly Alarm[],
    private readonly getObservedUT: () => number | null,
    /**
     * One-way signal delay to the craft, seconds, or 0 where there is none.
     *
     * A time alarm's instant is the game's own universal time while every
     * countdown planned here is on the view clock, so the two are a signal delay
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
      if (a.state !== "pending") continue;
      const instant = targetInstant(a);
      if (instant === null) continue;
      /* The light-time always comes off `ut`, the view clock: the mod stops the
         warp when the GAME reaches `ut - lead`, which the operator's screen
         reaches one light-time later. */
      const vantageOffset = safeOwltSeconds(this.getOwltSeconds());
      const remaining = instant.ut - vantageOffset - instant.leadSeconds - ut;
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
        (a) => a.state === "pending" && targetInstant(a) !== null,
      ) ?? null
    );
  }
}
