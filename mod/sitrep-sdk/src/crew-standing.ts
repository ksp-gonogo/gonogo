import { CrewStanding, KspRosterStatus } from "./__generated__/contract";
import { namesByValue } from "./enum-names";

/**
 * The name of each {@link CrewStanding} value: where a kerbal stands on the
 * books. It is not KSP's roster status: an applicant has no roster status,
 * and a kerbal standing down still has the roster status `Available`.
 *
 * @category Crew
 */
export const CREW_STANDING_NAMES = namesByValue(CrewStanding);

/**
 * The name of a {@link CrewStanding} member, as a string union.
 *
 * @category Crew
 */
export type CrewStandingName = keyof typeof CrewStanding;

/**
 * Every {@link CrewStanding}, in the order to group a crew list by: who can
 * fly, who is committed, who is off the books, with `Unknown` last.
 *
 * @category Crew
 */
export const CREW_STANDING_ORDER: readonly CrewStanding[] = [
  ...CREW_STANDING_NAMES.keys(),
]
  .sort((a, b) => a - b)
  .filter((standing) => standing !== CrewStanding.Unknown)
  .concat(CrewStanding.Unknown);

/**
 * Returns a {@link CrewStanding} from KSP's roster status, for a crew entry
 * that carries no `standing` of its own, as from an older version of the mod.
 * An applicant returns `Applicant`, and a missing or unknown status returns
 * `Unknown`.
 *
 * @category Crew
 */
export function crewStandingFromRosterStatus(
  rosterStatusOrdinal: number | null | undefined,
  isApplicant: boolean,
): CrewStanding {
  if (isApplicant) {
    return CrewStanding.Applicant;
  }
  switch (rosterStatusOrdinal) {
    case KspRosterStatus.Available:
      return CrewStanding.Available;
    case KspRosterStatus.Assigned:
      return CrewStanding.Assigned;
    case KspRosterStatus.Dead:
      return CrewStanding.Dead;
    case KspRosterStatus.Missing:
      return CrewStanding.Missing;
    default:
      return CrewStanding.Unknown;
  }
}

/**
 * Returns a standing's name to show, or `null` for a value this version does
 * not know. Show nothing rather than a made-up label.
 *
 * @category Crew
 */
export function crewStandingLabel(
  standing: number | null | undefined,
): string | null {
  if (standing === null || standing === undefined) {
    return null;
  }
  return CREW_STANDING_NAMES.get(standing) ?? null;
}

/**
 * Returns whether a standing should raise an alarm: the kerbal is dead or
 * missing.
 *
 * @category Crew
 */
export function isFatality(standing: number | null | undefined): boolean {
  return standing === CrewStanding.Dead || standing === CrewStanding.Missing;
}

/**
 * Returns whether the game would let this kerbal be dismissed: the standing
 * is `Available` or `Resting`. A resting kerbal cannot fly but can be
 * dismissed. Any other standing, including one added later, returns `false`.
 *
 * @category Crew
 */
export function canBeSacked(standing: number | null | undefined): boolean {
  return (
    standing === CrewStanding.Available || standing === CrewStanding.Resting
  );
}

/**
 * Returns why a kerbal cannot fly, with when that ends where it is known:
 * "Standing down", or "Standing down until Y2 D14". Returns `null` when the
 * kerbal can fly.
 *
 * @param reason - The payload's `unavailableReason`. Empty or absent means the
 * kerbal can fly.
 * @param endsAtUt - The payload's `standingEndsAtUt`, or `null` when the
 * standing has no set end.
 * @param formatUt - Your own UT formatter, so the date uses the game's
 * calendar. Omit it to get the reason alone.
 *
 * @category Crew
 */
export function crewUnavailableSentence(
  reason: string | null | undefined,
  endsAtUt: number | null | undefined,
  formatUt?: (ut: number) => string,
): string | null {
  if (!reason) {
    return null;
  }
  if (
    endsAtUt === null ||
    endsAtUt === undefined ||
    !Number.isFinite(endsAtUt) ||
    formatUt === undefined
  ) {
    return reason;
  }
  return `${reason} until ${formatUt(endsAtUt)}`;
}
