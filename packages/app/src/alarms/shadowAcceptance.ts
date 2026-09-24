import type { LogEntry } from "@ksp-gonogo/logger";
import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";

/**
 * The shadow comparison's verdict, from a run's own log.
 *
 * Kept apart from the runner that produces the log so the judgement can be
 * exercised without a game: a classifier that decides whether a feature is safe
 * to flip has to be shown capable of saying no, and it cannot be shown that
 * against a session nobody can reproduce.
 *
 * It judges FIRES, not lines. Each fire of a command-vantage threshold leaves
 * one line from each evaluator, keyed by the alarm's `id`, and the pair is the
 * evidence: a line on its own says only what one side saw.
 */

/** The five lines `AlarmHostService` writes, one per thing a side can see. */
export const SHADOW_LINES = {
  /** Mod side, opening a fire: the mod reached the verdict first. */
  modFirst: "alarm-shadow: mod fired first, client still pending",
  /** Mod side, closing a client-first fire. */
  modAgrees: "alarm-shadow: mod agrees, client had already fired",
  /** Mod side, with nothing to pair against: this client holds no such alarm. */
  modUnheld: "alarm-shadow: mod fired an alarm this client does not hold",
  /** Client side, opening a fire the mod has not reached. */
  clientFirst: "alarm-shadow: client fired, mod has not",
  /** Client side, closing a mod-first fire. */
  clientAgrees: "alarm-shadow: client fired, mod had already agreed",
} as const;

/**
 * The sample-size floor: how many paired fires a run needs before a clean log
 * means agreement rather than inactivity. Below it the run is INCONCLUSIVE,
 * never FAIL, because too few fires is a short session, not a disagreement.
 */
export const MINIMUM_FIRINGS = 10;

/**
 * How a run prints its delay: in seconds, to the millisecond. The default
 * duration ladder rounds a 2.675 s link to 2 s, which hides the figure a run is
 * read for.
 */
export const DELAY_FORMAT = { scale: "never", decimals: 3 } as const;

/**
 * What became of one fire.
 *
 * - `paired`: both sides, mod first and then the client
 * - `client-first`: both sides, but the client fired while the mod had not,
 *   which is the one divergence the client can see and must never happen for a
 *   same-vantage threshold
 * - `one-sided`: a side fired and the evidence says the other never will: the
 *   mod fired an alarm this client does not hold, or a closing line arrived
 *   with no fire open for it to close
 * - `unresolved`: opened and not yet closed when the log ends. At a real
 *   light-time a mod-first fire near the end of a run is still in flight to the
 *   client, so this is a run cut short, not a disagreement
 */
export type ShadowFireOutcome =
  | "paired"
  | "client-first"
  | "one-sided"
  | "unresolved";

export interface ShadowFire {
  id: string;
  outcome: ShadowFireOutcome;
  /**
   * The highest warp rate either line recorded, `null` when neither carried
   * one (a log from before the field existed, or no warp reading at all).
   */
  warpRate: number | null;
  /** The fire's own lines, in log order. */
  lines: readonly LogEntry[];
}

/**
 * A named class of fire set aside from the verdict: counted neither for nor
 * against, and listed in the result under its name. Which classes belong here
 * is evidence from a run, so the classifier ships with none.
 */
export interface ShadowExclusion {
  name: string;
  appliesTo(fire: ShadowFire): boolean;
}

export interface ShadowRunInput {
  entries: readonly LogEntry[];
  /**
   * One-way light time during the run. `null` is the mod's own word for
   * nothing measurable, and a run without a delay cannot tell the two
   * evaluators apart at all.
   */
  owlt: Value | null;
  /** Paired fires needed before the run can pass. Defaults to `MINIMUM_FIRINGS`. */
  minimumFires?: number;
  /**
   * The laps the scenario flew, and the alarms each lap must show agreeing.
   *
   * The run counts crossings rather than agreements because a scenario that
   * produces no events produces no disagreements either, and zero out of zero
   * reads exactly like a pass. A trajectory whose thresholds come due on every
   * lap gives a known number of events, so a missing one says something about
   * the feature rather than about the scenario. Fewer paired fires than `count`
   * for any listed alarm is INCONCLUSIVE.
   *
   * `alarmOf` names the alarm a fire belongs to, for a scenario that re-arms by
   * creating a fresh alarm per lap; it defaults to the fire's own `id`.
   */
  laps?: {
    count: number;
    alarms: readonly string[];
    alarmOf?: (fire: ShadowFire) => string;
  };
  exclusions?: readonly ShadowExclusion[];
}

export interface ShadowRunVerdict {
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  reason: string;
  /** Every fire the log shows that no exclusion claimed. */
  fires: readonly ShadowFire[];
  /** How many of `fires` ended in each outcome. */
  outcomes: Record<ShadowFireOutcome, number>;
  /** Paired fires whose recorded warp rate was above 1x. */
  pairedUnderWarp: number;
  /** Paired fires per alarm, as `laps.alarmOf` names them (by `id` without one). */
  pairedByAlarm: Record<string, number>;
  excluded: readonly { name: string; fires: readonly ShadowFire[] }[];
}

function contextString(entry: LogEntry, key: string): string | null {
  const v = entry.context?.[key];
  return typeof v === "string" ? v : null;
}

function contextNumber(entry: LogEntry, key: string): number | null {
  const v = entry.context?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fireOf(
  id: string,
  outcome: ShadowFireOutcome,
  lines: readonly LogEntry[],
): ShadowFire {
  const rates = lines
    .map((l) => contextNumber(l, "warpRate"))
    .filter((r): r is number => r !== null);
  return {
    id,
    outcome,
    warpRate: rates.length > 0 ? Math.max(...rates) : null,
    lines,
  };
}

/**
 * Walk the shadow lines in log order and cut them into fires, per alarm.
 *
 * An alarm re-armed under the same id fires again, so an id can carry several
 * fires in sequence; at most one is open at a time, because the service
 * latches an alarm until it fires.
 */
export function collectShadowFires(entries: readonly LogEntry[]): ShadowFire[] {
  const fires: ShadowFire[] = [];
  const open = new Map<
    string,
    { opener: "mod" | "client"; lines: LogEntry[] }
  >();

  for (const entry of entries) {
    if (!entry.message.startsWith("alarm-shadow:")) continue;
    const id = contextString(entry, "id");
    if (id === null) {
      // Unpairable, so it counts against the run rather than vanishing from it.
      fires.push(fireOf("", "one-sided", [entry]));
      continue;
    }
    const current = open.get(id);

    switch (entry.message) {
      case SHADOW_LINES.modUnheld:
        fires.push(fireOf(id, "one-sided", [entry]));
        break;
      case SHADOW_LINES.modFirst:
      case SHADOW_LINES.clientFirst: {
        if (current) {
          fires.push(
            fireOf(
              id,
              current.opener === "client" ? "client-first" : "one-sided",
              current.lines,
            ),
          );
        }
        open.set(id, {
          opener: entry.message === SHADOW_LINES.modFirst ? "mod" : "client",
          lines: [entry],
        });
        break;
      }
      case SHADOW_LINES.clientAgrees:
      case SHADOW_LINES.modAgrees: {
        const closes =
          entry.message === SHADOW_LINES.clientAgrees ? "mod" : "client";
        if (current?.opener === closes) {
          open.delete(id);
          fires.push(
            fireOf(id, closes === "mod" ? "paired" : "client-first", [
              ...current.lines,
              entry,
            ]),
          );
        } else {
          fires.push(fireOf(id, "one-sided", [entry]));
        }
        break;
      }
    }
  }
  for (const [id, { opener, lines }] of open) {
    fires.push(
      fireOf(id, opener === "client" ? "client-first" : "unresolved", lines),
    );
  }
  return fires;
}

export function classifyShadowRun(input: ShadowRunInput): ShadowRunVerdict {
  const exclusions = input.exclusions ?? [];
  const excluded = exclusions.map((x) => ({
    name: x.name,
    fires: [] as ShadowFire[],
  }));
  const fires: ShadowFire[] = [];
  for (const fire of collectShadowFires(input.entries)) {
    const i = exclusions.findIndex((x) => x.appliesTo(fire));
    if (i >= 0) excluded[i].fires.push(fire);
    else fires.push(fire);
  }

  const outcomes: Record<ShadowFireOutcome, number> = {
    paired: 0,
    "client-first": 0,
    "one-sided": 0,
    unresolved: 0,
  };
  const alarmOf = input.laps?.alarmOf ?? ((fire: ShadowFire) => fire.id);
  const pairedByAlarm: Record<string, number> = {};
  let pairedUnderWarp = 0;
  for (const fire of fires) {
    outcomes[fire.outcome] += 1;
    if (fire.outcome !== "paired") continue;
    const alarm = alarmOf(fire);
    pairedByAlarm[alarm] = (pairedByAlarm[alarm] ?? 0) + 1;
    if (fire.warpRate !== null && fire.warpRate > 1) pairedUnderWarp += 1;
  }

  const result = (
    verdict: ShadowRunVerdict["verdict"],
    reason: string,
  ): ShadowRunVerdict => ({
    verdict,
    reason,
    fires,
    outcomes,
    pairedUnderWarp,
    pairedByAlarm,
    excluded,
  });

  if (outcomes["client-first"] > 0) {
    return result(
      "FAIL",
      `${outcomes["client-first"]} fire(s) where the client fired and the mod had not`,
    );
  }
  if (outcomes["one-sided"] > 0) {
    return result(
      "FAIL",
      `${outcomes["one-sided"]} fire(s) seen by only one side`,
    );
  }
  if (!input.owlt?.greaterThan(0)) {
    return result(
      "INCONCLUSIVE",
      "no one-way delay, so the two evaluators cannot disagree and a clean log proves nothing",
    );
  }
  if (outcomes.unresolved > 0) {
    return result(
      "INCONCLUSIVE",
      `${outcomes.unresolved} fire(s) still waiting on the other side when the log ends; run on past the last fire by more than the light-time`,
    );
  }
  const minimumFires = input.minimumFires ?? MINIMUM_FIRINGS;
  if (outcomes.paired < minimumFires) {
    return result(
      "INCONCLUSIVE",
      `only ${outcomes.paired} paired fire(s); a run needs ${minimumFires} before quiet means agreement rather than inactivity`,
    );
  }
  const laps = input.laps;
  const short = laps
    ? laps.alarms.filter((alarm) => (pairedByAlarm[alarm] ?? 0) < laps.count)
    : [];
  if (laps && short.length > 0) {
    return result(
      "INCONCLUSIVE",
      `${short.length} alarm(s) short of ${laps.count} paired fire(s), one per lap: ${short.join(", ")}`,
    );
  }
  if (pairedUnderWarp === 0) {
    return result(
      "INCONCLUSIVE",
      "no paired fire under warp, where the two clocks part furthest",
    );
  }
  return result(
    "PASS",
    `${outcomes.paired} paired fire(s), ${pairedUnderWarp} under warp, none one-sided, at a one-way delay of ${writeQuantity(input.owlt, DELAY_FORMAT)}`,
  );
}
