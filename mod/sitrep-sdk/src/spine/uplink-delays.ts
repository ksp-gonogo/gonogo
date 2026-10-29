import { readOneWaySeconds } from "./delay-authority";

/**
 * The `system.uplink.delays` channel topic: which delayed commands address the
 * active craft, and the delay each of the others takes from this session's
 * command centre to its own target. Read by `useCommand`.
 */
export const UPLINK_DELAYS_TOPIC = "system.uplink.delays";

/**
 * Where a delayed command goes, as `system.uplink.delays` reports it: to the
 * active craft, which takes that craft's own delay, or somewhere else, with the
 * delay from the session's centre (`null` while that centre knows none).
 * Returned by {@link commandTargetOf}.
 */
export type CommandTarget =
  | { readonly kind: "active-vessel" }
  | { readonly kind: "elsewhere"; readonly seconds: number | null };

const ACTIVE_VESSEL: CommandTarget = Object.freeze({ kind: "active-vessel" });

/**
 * Where `command` goes according to a `system.uplink.delays` payload, or
 * `null` when the payload is not one or does not list the command. Useful for
 * timing a command by the delay to its own target rather than to the active
 * craft. Used by `useCommand`.
 *
 * `centre` picks the row for a command sent from a centre named by the caller;
 * without it any row counts, since the mod sends a session only its own
 * centre's rows. A command listed elsewhere with no row for `centre` has no
 * known delay.
 */
export function commandTargetOf(
  payload: unknown,
  command: string,
  centre?: string,
): CommandTarget | null {
  if (typeof payload !== "object" || payload === null) return null;
  const active = "activeVessel" in payload ? payload.activeVessel : undefined;
  const elsewhere = "elsewhere" in payload ? payload.elsewhere : undefined;
  if (!Array.isArray(active) || !Array.isArray(elsewhere)) return null;
  if (active.includes(command)) return ACTIVE_VESSEL;
  let listed = false;
  for (const row of elsewhere) {
    if (typeof row !== "object" || row === null) continue;
    if (!("command" in row) || row.command !== command) continue;
    listed = true;
    if (centre !== undefined && "centre" in row && row.centre !== centre) {
      continue;
    }
    return {
      kind: "elsewhere",
      seconds: readOneWaySeconds(row),
    };
  }
  return listed ? { kind: "elsewhere", seconds: null } : null;
}
