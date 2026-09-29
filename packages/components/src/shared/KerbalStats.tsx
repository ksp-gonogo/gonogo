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
import { KerbalInfoPopover } from "./KerbalInfoPopover";

/** The stat fields a kerbal row renders; an applicant's veteran, flight and availability fields sit at their zero. */
export interface KerbalStatFields {
  name: string;
  trait: string;
  /** `null` when unsent: `L0` is a real rank, so a substituted zero would be an indistinguishable rookie. */
  experienceLevel: number | null;
  veteran: boolean;
  isBadass: boolean;
  careerFlights: number;
  available: boolean;
  unavailableReason: string;
  /** A display label only; {@link standing} is the field that decides anything. */
  situation: string;
  /** `CrewStanding`, which tells a retiree from a fatality where KSP's roster ordinal cannot. */
  standing?: number | null;
  /** KSP's own `RosterStatus` ordinal; nothing here branches on it. */
  situationOrdinal?: number | null;
  /** UT the current {@link standing} lapses, formatted client-side in the live calendar. */
  standingEndsAtUt?: number | null;
  currentVesselName: string;
  /** Ratio 0-1; always carried, so the chips are gated by `showTraits` rather than presence. */
  courage?: number | null;
  stupidity?: number | null;
  /** Progress toward the next rank, ratio 0-1. */
  experienceLevelDelta?: number | null;
  /** Stock trait tooltip strings for the current rank, shown by the info popover. */
  roleDescription?: string;
  descriptionEffects?: string;
}

/** KSP's top astronaut rank, where the progress chip reads "MAX" rather than 100%. */
const MAX_EXPERIENCE_LEVEL = 5;

/**
 * Only a fatality alarms; every other standing is neutral grey. Compared by
 * enum, never by label, because a rename would fail toward "nothing to see".
 */
function unavailableSeverity(
  standing: number | null | undefined,
): Severity | undefined {
  return isFatality(standing) ? "critical" : undefined;
}

/** Why the kerbal cannot fly, until when (in the client's calendar) and aboard what. */
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

/** A ratio stat chip, rendered even when its reading is absent: a vanished chip reads as a kerbal without the stat. */
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
      <span
        style={LEVEL_STYLE}
        role="img"
        title={`${name} unknown`}
        aria-label={`${name} unknown`}
      >
        <span style={STAT_SYMBOL_STYLE}>{symbol}</span> {NULL_DISPLAY}
      </span>
    );
  }
  const spoken = speakQuantity(value("ratio", reading));
  return (
    <span
      style={LEVEL_STYLE}
      role="img"
      title={`${name}: ${spoken}`}
      aria-label={`${name} ${spoken}`}
    >
      <span style={STAT_SYMBOL_STYLE}>{symbol}</span>{" "}
      <Unit value={value("ratio", reading)} />
    </span>
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
  /** Hidden for an applicant, who keeps a rank from an earlier hire. */
  showRank?: boolean;
  showTraits?: boolean;
  showExperienceProgress?: boolean;
  showInfo?: boolean;
  /** Appended at the end of the Meta row (e.g. an augment slot). */
  children?: ReactNode;
}) {
  const rankKnown = typeof kerbal.experienceLevel === "number";
  // An unknown rank is never the top one.
  const atMaxRank =
    rankKnown && (kerbal.experienceLevel as number) >= MAX_EXPERIENCE_LEVEL;
  return (
    <span style={META_STYLE}>
      <span
        style={TRAIT_TAG_STYLE}
        title={`Trait: ${kerbal.trait || "Unknown"}`}
      >
        {kerbal.trait || NULL_DISPLAY}
      </span>
      {showRank &&
        (rankKnown ? (
          <span
            style={LEVEL_STYLE}
            role="img"
            title={`Experience level ${kerbal.experienceLevel}`}
            aria-label={`Experience level ${kerbal.experienceLevel}`}
          >
            L{kerbal.experienceLevel}
          </span>
        ) : (
          <span
            style={LEVEL_STYLE}
            role="img"
            title="Experience level unknown"
            aria-label="Experience level unknown"
          >
            L{NULL_DISPLAY}
          </span>
        ))}
      {showTraits && (
        <RatioChip symbol="C" name="Courage" reading={kerbal.courage} />
      )}
      {showTraits && (
        <RatioChip symbol="S" name="Stupidity" reading={kerbal.stupidity} />
      )}
      {showExperienceProgress &&
        (atMaxRank ? (
          <span
            style={LEVEL_STYLE}
            role="img"
            title="Max rank"
            aria-label="Max rank"
          >
            MAX
          </span>
        ) : (
          <RatioChip
            symbol="XP"
            name="Experience toward next rank"
            reading={kerbal.experienceLevelDelta}
          />
        ))}
      {showInfo && (
        <KerbalInfoPopover
          name={kerbal.name}
          roleDescription={kerbal.roleDescription}
          descriptionEffects={kerbal.descriptionEffects}
        />
      )}
      {children}
    </span>
  );
}

/** A kerbal's name, ellipsised to the width its row leaves it. */
export function KerbalName({ name }: { name: string }) {
  return <span style={NAME_STYLE}>{name || NULL_DISPLAY}</span>;
}

/**
 * A kerbal's standing marks (veteran, badass, flights flown, and the one reason
 * they cannot fly), drawn at the top right of the kerbal's card beside the
 * card's other badges rather than in the stats row.
 */
export function KerbalBadges({ kerbal }: { kerbal: KerbalStatFields }) {
  return (
    <>
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
      {/* One badge for every way a kerbal cannot fly; a new axis needs no badge of its own. */}
      {!kerbal.available && (
        <Badge
          severity={unavailableSeverity(kerbal.standing)}
          size="sm"
          title={unavailableTitle(kerbal)}
        >
          {kerbal.unavailableReason || "Unavailable"}
        </Badge>
      )}
    </>
  );
}

const NAME_STYLE = {
  fontSize: "var(--font-size-value)",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

// Spaced to be read at a glance: packed tighter, the chips run together into one line.
const META_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-related)",
  alignItems: "center",
} as const;

/** The letter naming a stat, muted so the figure beside it carries the weight. */
const STAT_SYMBOL_STYLE = { color: "var(--color-text-muted)" } as const;

const TRAIT_TAG_STYLE = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.06em",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
} as const;

const LEVEL_STYLE = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-accent-fg)",
  fontVariantNumeric: "tabular-nums",
} as const;
