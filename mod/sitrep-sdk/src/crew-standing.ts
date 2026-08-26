import { CrewStanding } from "./__generated__/contract";
import { namesByValue } from "./enum-names";

/**
 * Value→name table and closed name union for `CrewStanding`, the contract's own
 * answer to where a kerbal sits on the books.
 *
 * Its own module rather than a row in `ksp-enum-names.ts`, because it is
 * deliberately NOT a mirror of a KSP enum. That file's registry test asserts a
 * table exists for every `Ksp*` enum the contract exports and that each table
 * matches KSP's declaration; `CrewStanding` would fail the first premise and
 * misrepresent the second. The whole reason it exists is that KSP's roster
 * status is not the answer once a career overhaul is installed.
 *
 * @see `Sitrep.Contract/CrewStanding.cs` for the account of what RP-1 does to
 * `rosterStatus` and why a mirror could not have been made to work.
 */
export const CREW_STANDING_NAMES = namesByValue(CrewStanding);

/** The members of {@link CrewStanding}, as a union a comparison can be checked against. */
export type CrewStandingName = keyof typeof CrewStanding;

/**
 * Standings ordered the way a crew surface reads them: who can fly, who is
 * committed, who is off the books.
 *
 * Derived from the enum's OWN numbering rather than transcribed, so a member
 * added to the contract takes a place here without anybody remembering to add
 * one. That is the specific failure this replaces: the Astronaut Complex ordered
 * its tabs off `KSP_ROSTER_STATUS_NAMES` and carried a comment promising that a
 * mod's "Retired" would get a tab for free. It never did, because RP-1 appends
 * no roster status; the ordering was fine and the premise was wrong.
 *
 * `Unknown` is deliberately LAST rather than first, despite being ordinal zero.
 * It is the standing nobody could read, and a surface should show what it does
 * know before what it does not.
 */
export const CREW_STANDING_ORDER: readonly CrewStanding[] = [
  ...CREW_STANDING_NAMES.keys(),
]
  .sort((a, b) => a - b)
  .filter((standing) => standing !== CrewStanding.Unknown)
  .concat(CrewStanding.Unknown);

/**
 * A standing's display label: the enum's own name, or `null` when the value is
 * one this build does not declare.
 *
 * Null rather than a fallback string, because a label invented for an unknown
 * number is a label an operator will read as a fact. A caller with nothing to
 * show should show nothing.
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
 * Whether a standing means the kerbal is off the flight roster for good: dead,
 * missing, or retired. The three an operator groups together when planning, and
 * the reason they must still be told apart within it.
 */
export function isOffTheBooks(standing: number | null | undefined): boolean {
  return (
    standing === CrewStanding.Dead ||
    standing === CrewStanding.Missing ||
    standing === CrewStanding.Retired
  );
}

/**
 * Whether a standing is worth ALARMING an operator over. A fatality and a
 * missing kerbal are; a retirement is not, and that distinction is the whole
 * point of the standing existing.
 *
 * Reads the standing, never a label. Matched by name, a rename on either side
 * sends a dead kerbal's badge quietly grey, and failing toward "nothing to see"
 * is the worst available direction for the one badge whose job is to be
 * alarming.
 */
export function isFatality(standing: number | null | undefined): boolean {
  return standing === CrewStanding.Dead || standing === CrewStanding.Missing;
}
