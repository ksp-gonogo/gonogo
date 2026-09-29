import { getStationKey } from "../peer/stationPeerId";
import { CommcastLog, type CommcastLogOptions } from "./CommcastLog";

/**
 * The host screen's own log.
 *
 * Built at screen level rather than in the widget because a message addressed
 * here arrives whether or not the tile is on the dashboard. It is pure: it reads
 * storage and registers nothing, which is what makes it safe in a `useState`
 * initialiser. Putting it on the mod is `attachCommcastModLink`, owned by an
 * effect that can undo it.
 */
export function createCommcastLog(
  opts: Partial<CommcastLogOptions> = {},
): CommcastLog {
  return new CommcastLog({
    ...opts,
    screenKey: opts.screenKey ?? getStationKey(),
  });
}
