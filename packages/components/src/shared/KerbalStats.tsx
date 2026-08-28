import {
  crewUnavailableSentence,
  isFatality,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  NULL_DISPLAY,
  type Severity,
  speakQuantity,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import styled from "styled-components";
import { KerbalInfoPopover } from "./KerbalInfoPopover";

// ---------------------------------------------------------------------------
// Shared kerbal stat block: name + trait/level/trait-badge row.
//
// One renderer for a single kerbal's astronaut stats, used across the
// Astronaut Complex's Applicants and Active tabs so a candidate reads at the
// same fidelity as a hired crew member. Renders the
// Name plus a Meta row carrying trait, experience level, and the veteran /
// badass / career-flight / unavailable badges. Callers own the surrounding
// card and any trailing chrome (a hire button, an augment slot), which they
// pass as `children` to append inside the Meta row.
// ---------------------------------------------------------------------------

/** The stat fields a kerbal row renders. A superset of what a fresh applicant
 *  carries: applicants set the veteran / badass / flight / availability fields
 *  to their safe zero (a new recruit has no flights and is always available to
 *  hire), so those badges simply do not appear. */
export interface KerbalStatFields {
  name: string;
  trait: string;
  /** Rank, `null` when the producer sent none. Nullable rather than defaulted,
   *  because `L0` is a rank every save has a real kerbal at, so a substituted
   *  zero here is a rookie the operator cannot tell from a reading that never
   *  arrived. */
  experienceLevel: number | null;
  veteran: boolean;
  isBadass: boolean;
  careerFlights: number;
  available: boolean;
  unavailableReason: string;
  /** Standing as a DISPLAY LABEL. Shown, never compared: {@link standing} is
   *  the field that decides anything. */
  situation: string;
  /** `CrewStanding`, the contract's own answer, driving the unavailable badge's
   *  severity. This is the field that tells a retiree from a fatality, and the
   *  reason the badge no longer reads the KSP ordinal: under RP-1 that ordinal
   *  is `Dead` for a living retiree. `undefined` for a caller that carries no
   *  standing. */
  standing?: number | null;
  /** KSP's OWN `RosterStatus` ordinal, carried for a caller that needs to know
   *  what the game holds. Nothing here branches on it. */
  situationOrdinal?: number | null;
  /** When the current {@link standing} lapses, as universal time: a course's
   *  ETA, a rest period's end. Absent for a standing with no scheduled end.
   *  Joined onto {@link unavailableReason} for the badge's title, so the date is
   *  formatted in the client's calendar and never on the wire. */
  standingEndsAtUt?: number | null;
  currentVesselName: string;
  /** Ratio 0-1. Carried as non-optional (defaulted via `magnitudeOr(…, 0)`),
   *  so presence alone can't gate the chips: a caller must opt in with
   *  `showTraits` below. */
  courage?: number | null;
  stupidity?: number | null;
  /** Progress toward the next rank, ratio 0-1 (`ProtoCrewMember.ExperienceLevelDelta`).
   *  Only meaningful once a kerbal is hired (an applicant's rank is withheld
   *  entirely via `showRank={false}`), so gated by its own `showExperienceProgress`
   *  opt-in rather than folded into `showRank`. */
  experienceLevelDelta?: number | null;
  /** The stock trait tooltip strings (`ExperienceTrait.Description` /
   *  `DescriptionEffects`, current rank only). Rendered by the info popover
   *  when `showInfo` is set; absent or empty renders the popover's graceful
   *  no-description state rather than an empty panel. */
  roleDescription?: string;
  descriptionEffects?: string;
}

/** KSP's top astronaut rank: `ExperienceLevelDelta` reads 1 here (no further
 *  rank to progress toward), so the progress chip reads "MAX" instead of a
 *  redundant 100%. */
const MAX_EXPERIENCE_LEVEL = 5;

/**
 * Severity for the unavailable badge. `Dead`/`Missing` are the only standings
 * worth alarming an operator over; `Assigned` ("on mission") is the expected,
 * healthy state for a crewed vessel, `Retired` is a career that ended well, and
 * a standing this build does not declare stays neutral rather than crying wolf.
 * Undefined renders Badge's decorative grey, the same "just busy" chip the
 * career-flights count uses.
 *
 * Reads the STANDING, and this is where the RP-1 retiree defect surfaced. It
 * used to read KSP's own roster ordinal, which RP-1 sets to `Dead` when it
 * retires a kerbal, so every retiree on the board wore a red fatality badge.
 * The standing is the contract's own answer and tells the two apart.
 *
 * Still an enum comparison rather than a label one: matched by name, a rename
 * on either side sends a dead kerbal's badge quietly grey, and failing toward
 * "nothing to see" is the worst available direction for the one badge whose
 * whole job is to be alarming.
 */
function unavailableSeverity(
  standing: number | null | undefined,
): Severity | undefined {
  return isFatality(standing) ? "critical" : undefined;
}

/**
 * The badge's title: why the kerbal cannot fly, until when, and aboard what.
 *
 * The date is joined on HERE rather than read off the wire, through the SDK's
 * `crewUnavailableSentence`, because the producer deliberately sends
 * `unavailableReason` as prose and the when as a `ut` value: a date formatted in
 * the mod would be formatted in the mod's idea of a calendar. `speakQuantity` is
 * the client's own renderer, so an RSS save reads in RSS years.
 */
function unavailableTitle(kerbal: KerbalStatFields): string {
  const sentence =
    crewUnavailableSentence(
      kerbal.unavailableReason,
      kerbal.standingEndsAtUt,
      (ut) => speakQuantity(value("ut", ut)),
    ) ?? "Unavailable";
  return kerbal.currentVesselName
    ? `${sentence} (${kerbal.currentVesselName})`
    : sentence;
}

/**
 * One ratio-valued stat chip: courage, stupidity, progress toward the next
 * rank. Rendered whether or not its reading arrived, because the caller asked
 * for the chip and a chip that quietly disappears reads as a kerbal who has no
 * such stat. Absent, it says a dash and names itself unknown.
 */
function RatioChip({
  symbol,
  name,
  reading,
}: {
  symbol: string;
  name: string;
  reading: number | null | undefined;
}) {
  if (typeof reading !== "number") {
    return (
      <Level title={`${name} unknown`} aria-label={`${name} unknown`}>
        {symbol} {NULL_DISPLAY}
      </Level>
    );
  }
  const spoken = speakQuantity(value("ratio", reading));
  return (
    <Level title={`${name}: ${spoken}`} aria-label={`${name} ${spoken}`}>
      {symbol} <Unit value={value("ratio", reading)} />
    </Level>
  );
}

export function KerbalStats({
  kerbal,
  showRank = true,
  showTraits = false,
  showExperienceProgress = false,
  showInfo = false,
  children,
}: {
  kerbal: KerbalStatFields;
  /** Rank (`L{experienceLevel}`) only makes sense once a kerbal is actually
   *  on the books: an applicant keeps the field on the model (astronauts
   *  retain experience across a dismiss/rehire) but it isn't shown until
   *  they're hired. Defaults to shown, the existing behaviour every current
   *  caller relies on. */
  showRank?: boolean;
  /** Courage/Stupidity chips. Explicit opt-in rather than inferred from
   *  `kerbal.courage`/`stupidity` being set: those fields are always
   *  defaulted (never undefined), so presence alone can't gate the chips.
   *  Defaults to hidden, the existing behaviour every current caller
   *  relies on. */
  showTraits?: boolean;
  /** Progress-toward-next-rank chip. Same explicit-opt-in reasoning as
   *  `showTraits`: defaults to hidden so existing callers are unaffected. */
  showExperienceProgress?: boolean;
  /** The per-row info popover (role description + current-rank effects).
   *  Defaults to hidden, the existing behaviour every current caller
   *  relies on. */
  showInfo?: boolean;
  /** Appended at the end of the Meta row (e.g. an augment slot). */
  children?: ReactNode;
}) {
  const rankKnown = typeof kerbal.experienceLevel === "number";
  // Only a rank we have can be the top one. Unknown, the progress chip quotes
  // whatever ratio arrived rather than claiming a career that cannot progress.
  const atMaxRank =
    rankKnown && (kerbal.experienceLevel as number) >= MAX_EXPERIENCE_LEVEL;
  return (
    <>
      <KerbalStats__Name>{kerbal.name || NULL_DISPLAY}</KerbalStats__Name>
      <KerbalStats__Meta>
        <TraitTag title={`Trait: ${kerbal.trait || "Unknown"}`}>
          {kerbal.trait || NULL_DISPLAY}
        </TraitTag>
        {showRank &&
          (rankKnown ? (
            <Level
              title={`Experience level ${kerbal.experienceLevel}`}
              aria-label={`Experience level ${kerbal.experienceLevel}`}
            >
              L{kerbal.experienceLevel}
            </Level>
          ) : (
            <Level
              title="Experience level unknown"
              aria-label="Experience level unknown"
            >
              L{NULL_DISPLAY}
            </Level>
          ))}
        {showTraits && (
          <RatioChip symbol="C" name="Courage" reading={kerbal.courage} />
        )}
        {showTraits && (
          <RatioChip symbol="S" name="Stupidity" reading={kerbal.stupidity} />
        )}
        {showExperienceProgress &&
          (atMaxRank ? (
            <Level title="Max rank" aria-label="Max rank">
              MAX
            </Level>
          ) : (
            <RatioChip
              symbol="XP"
              name="Experience toward next rank"
              reading={kerbal.experienceLevelDelta}
            />
          ))}
        {kerbal.veteran && (
          <Badge
            severity="nominal"
            size="sm"
            aria-label="veteran"
            title="Veteran: has flown a notable mission"
          >
            ★
          </Badge>
        )}
        {kerbal.isBadass && (
          <Badge
            severity="warning"
            size="sm"
            aria-label="badass"
            title="Badass: KSP's brave trait; rarely panics"
          >
            BA
          </Badge>
        )}
        {kerbal.careerFlights > 0 && (
          <Badge
            size="sm"
            aria-label={`${kerbal.careerFlights} flights`}
            title={`${kerbal.careerFlights} career flight${kerbal.careerFlights === 1 ? "" : "s"} completed`}
          >
            {kerbal.careerFlights}F
          </Badge>
        )}
        {/* ONE badge for every way a kerbal cannot fly, driven by the derived
          `available` / `unavailableReason` pair rather than by a per-axis flag.
          There used to be a bespoke RESTING badge beside this reading
          `inactive`, from when a stand-down was not a standing: it showed
          alongside this one the moment the derivation started producing
          `Resting`, saying the same thing twice. A new axis needs no badge of
          its own, which is the whole point of the producer deriving the pair. */}
        {!kerbal.available && (
          <Badge
            severity={unavailableSeverity(kerbal.standing)}
            size="sm"
            title={unavailableTitle(kerbal)}
          >
            {kerbal.unavailableReason || "Unavailable"}
          </Badge>
        )}
        {showInfo && (
          <KerbalInfoPopover
            name={kerbal.name}
            roleDescription={kerbal.roleDescription}
            descriptionEffects={kerbal.descriptionEffects}
          />
        )}
        {children}
      </KerbalStats__Meta>
    </>
  );
}

const KerbalStats__Name = styled.span`
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const KerbalStats__Meta = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: center;
`;

const TraitTag = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
  text-transform: uppercase;
`;

const Level = styled.span`
  font-size: var(--font-size-2xs);
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;
