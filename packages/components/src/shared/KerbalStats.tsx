import { value } from "@ksp-gonogo/sitrep-sdk";
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
  experienceLevel: number;
  veteran: boolean;
  isBadass: boolean;
  careerFlights: number;
  available: boolean;
  unavailableReason: string;
  /** Raw roster standing (`Available`/`Assigned`/`Dead`/`Missing`, plus any
   *  mod value). Drives the unavailable badge's severity: `Dead`/`Missing`
   *  are genuinely alarming, everything else (an applicant, or a kerbal
   *  `Assigned` to a mission) is a normal state and never renders critical. */
  situation: string;
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

/** Severity for the unavailable badge. `Dead`/`Missing` are the only
 *  situations worth alarming an operator over; `Assigned` ("on mission") is
 *  the expected, healthy state for a crewed vessel, and an unrecognised
 *  situation (a mod value this list has never heard of) defaults to the same
 *  neutral read rather than crying wolf. Undefined renders Badge's
 *  decorative grey, the same "just busy" chip the career-flights count uses. */
function unavailableSeverity(situation: string): Severity | undefined {
  return situation === "Dead" || situation === "Missing"
    ? "critical"
    : undefined;
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
  const showCourage = showTraits && typeof kerbal.courage === "number";
  const showStupidity = showTraits && typeof kerbal.stupidity === "number";
  const showExperience =
    showExperienceProgress && typeof kerbal.experienceLevelDelta === "number";
  const atMaxRank = kerbal.experienceLevel >= MAX_EXPERIENCE_LEVEL;
  return (
    <>
      <KerbalStats__Name>{kerbal.name || NULL_DISPLAY}</KerbalStats__Name>
      <KerbalStats__Meta>
        <TraitTag title={`Trait: ${kerbal.trait || "Unknown"}`}>
          {kerbal.trait || NULL_DISPLAY}
        </TraitTag>
        {showRank && (
          <Level
            title={`Experience level ${kerbal.experienceLevel}`}
            aria-label={`Experience level ${kerbal.experienceLevel}`}
          >
            L{kerbal.experienceLevel}
          </Level>
        )}
        {showCourage && (
          <Level
            title={`Courage: ${speakQuantity(value("ratio", kerbal.courage as number))}`}
            aria-label={`Courage ${speakQuantity(value("ratio", kerbal.courage as number))}`}
          >
            C <Unit value={value("ratio", kerbal.courage as number)} />
          </Level>
        )}
        {showStupidity && (
          <Level
            title={`Stupidity: ${speakQuantity(value("ratio", kerbal.stupidity as number))}`}
            aria-label={`Stupidity ${speakQuantity(value("ratio", kerbal.stupidity as number))}`}
          >
            S <Unit value={value("ratio", kerbal.stupidity as number)} />
          </Level>
        )}
        {showExperience &&
          (atMaxRank ? (
            <Level title="Max rank" aria-label="Max rank">
              MAX
            </Level>
          ) : (
            <Level
              title={`Experience toward next rank: ${speakQuantity(value("ratio", kerbal.experienceLevelDelta as number))}`}
              aria-label={`Experience toward next rank ${speakQuantity(value("ratio", kerbal.experienceLevelDelta as number))}`}
            >
              XP{" "}
              <Unit
                value={value("ratio", kerbal.experienceLevelDelta as number)}
              />
            </Level>
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
        {!kerbal.available && (
          <Badge
            severity={unavailableSeverity(kerbal.situation)}
            size="sm"
            title={
              kerbal.currentVesselName
                ? `${kerbal.unavailableReason || "Unavailable"} (${kerbal.currentVesselName})`
                : kerbal.unavailableReason || "Unavailable"
            }
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
