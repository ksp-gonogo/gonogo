import { CrewStanding, KspRosterStatus } from "./__generated__/contract";
import { namesByValue } from "./enum-names";

/**
 * Value→name table and closed name union for `CrewStanding`, the contract's own
 * statement of where a kerbal sits on the books.
 *
 * Not a mirror of a KSP enum: an applicant has no roster status at all, and a
 * kerbal standing down still reads `Available` there.
 *
 * @see `Sitrep.Contract/CrewStanding.cs`
 *
 * @category Crew
 */
export const CREW_STANDING_NAMES = namesByValue(CrewStanding);

/**
 * The members of {@link CrewStanding}, as a union a comparison can be checked
 * against.
 *
 * @category Crew
 */
export type CrewStandingName = keyof typeof CrewStanding;

/**
 * Standings ordered the way a crew surface reads them: who can fly, who is
 * committed, who is off the books.
 *
 * Derived from the enum's OWN numbering rather than transcribed, so a member
 * added to the contract takes a place here without anybody remembering to add
 * one.
 *
 * `Unknown` is deliberately LAST rather than first, despite being ordinal zero.
 * It is the standing nobody could read, and a surface should show what it does
 * know before what it does not.
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
 * KSP's roster status as a `CrewStanding`, the client-side twin of the
 * contract's `CrewStandings.FromRosterStatus`.
 *
 * <p>Its job is VERSION SKEW. The producer stamps `standing` on every crew
 * entry, so a client talking to a current mod build never reaches this. A
 * client talking to a mod build from before the crew-standing capability gets
 * no `standing` at all, and without this every kerbal on the roster would
 * bucket as `Unknown`: a wall of "we do not know where any of your crew stands"
 * about a save that is fine. The roster status is still on the wire in that
 * case and still means what stock means by it, so it is read.</p>
 *
 * <p>An applicant returns {@link CrewStanding.Applicant} without the ordinal
 * being consulted, because an applicant has none; an unrecognised or absent
 * ordinal returns {@link CrewStanding.Unknown} rather than the friendliest
 * guess.</p>
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
 * A standing's display label: the enum's own name, or `null` when the value is
 * one this build does not declare.
 *
 * Null rather than a fallback string, because a label invented for an unknown
 * number is a label an operator will read as a fact. A caller with nothing to
 * show should show nothing.
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
 * Whether a standing is worth ALARMING an operator over: a fatality or a
 * missing kerbal.
 *
 * Reads the standing, never a label. Matched by name, a rename on either side
 * sends a dead kerbal's badge quietly grey, and failing toward "nothing to see"
 * is the worst available direction for the one badge whose job is to be
 * alarming.
 *
 * @category Crew
 */
export function isFatality(standing: number | null | undefined): boolean {
  return standing === CrewStanding.Dead || standing === CrewStanding.Missing;
}

/**
 * Whether a standing means the kerbal is ON THE BOOKS and idle, so the roster
 * will accept a sacking: `Available` or `Resting`.
 *
 * <p>Its own question, deliberately not `available`. Firing is not flying, and
 * conflating them costs an operator a legitimate everyday action: a kerbal
 * standing down after a flight cannot be assigned to a mission and can
 * perfectly well be let go. KSP's own authority agrees, and is what this
 * mirrors: `KerbalRoster.SackAvailable` is gated on
 * `rosterStatus == Available`, which is what KSP holds for a resting
 * kerbal.</p>
 *
 * <p>A WHITELIST, for the reason the contract's `CanFly` is one: a standing
 * added later is not sackable until somebody writes down that it is. The
 * direction matters here too, because the failure is offering a control that
 * will be refused, or worse one the operator did not mean for a kerbal who is
 * off the books.</p>
 *
 * @category Crew
 */
export function canBeSacked(standing: number | null | undefined): boolean {
  return (
    standing === CrewStanding.Available || standing === CrewStanding.Resting
  );
}

/**
 * The whole sentence for why a kerbal cannot fly, WITH the when: "Standing
 * down", or "Standing down until Y2 D14".
 *
 * <p>Composed here rather than on the wire, and that is the point of it. The
 * producer sends `unavailableReason` as prose and `standingEndsAtUt` as a `ut`
 * value, because a date baked into a string would be baked in the mod's idea of
 * a calendar, and the client owns the calendar. The
 * joining belongs on the side that owns the calendar, and doing it once here
 * means no widget re-derives it.</p>
 *
 * @param reason the payload's `unavailableReason`; an empty or absent one means
 *   the kerbal can fly and this returns `null`
 * @param endsAtUt the payload's `standingEndsAtUt`, or null when the standing
 *   has no scheduled end
 * @param formatUt the caller's own UT formatter, so the date is rendered in the
 *   client's calendar. Omit it to get the reason alone
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
