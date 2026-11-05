import type { Alarm } from "./types";

const STATE_PRIORITY: Record<Alarm["state"], number> = {
  firing: 0,
  fired: 1,
  arming: 2,
  pending: 3,
};

function sortKey(alarm: Alarm): number {
  return alarm.trigger.kind === "time"
    ? alarm.trigger.ut
    : (alarm.followedUT ?? Number.POSITIVE_INFINITY);
}

/**
 * The alarms in the order a screen's alarm bar leads with them: firing before
 * fired before arming before pending, then the earliest time first. A
 * threshold alarm has no single firing time, so it follows the time alarms of
 * its state. Used by the main screen's bar and every station's bar, so all of
 * them lead with the same alarm.
 */
export function orderAlarms(alarms: readonly Alarm[]): Alarm[] {
  return [...alarms].sort((a, b) => {
    const p = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
    if (p !== 0) return p;
    return sortKey(a) - sortKey(b);
  });
}
