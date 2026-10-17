import { CatalogCrew, CatalogEnd, type Value } from "@ksp-gonogo/sitrep-sdk";
import { VisuallyHidden, writeQuantity } from "@ksp-gonogo/ui-kit";
import { TONE_TEXT } from "./comms";
import { crewLabel, type FleetVessel } from "./fleet";

const KNOWN_AS: Record<CatalogCrew, string> = {
  [CatalogCrew.Known]: "known",
  [CatalogCrew.Unknown]: "unknown",
  [CatalogCrew.PresumedLost]: "presumed-lost",
  [CatalogCrew.Lost]: "lost",
};

interface EndedCrew {
  dead: Value<"count"> | null;
  missing: Value<"count"> | null;
}

/**
 * What the game's roster says of the crew of a craft the player ended from the
 * Tracking Station; null when the end was another kind, the roster was not
 * read, or it holds neither a dead nor a missing kerbal.
 */
function endedCrew(vessel: FleetVessel): EndedCrew | null {
  const { endKind, crewDead, crewMissing } = vessel.contact;
  if (endKind !== CatalogEnd.Terminated) return null;
  const dead = crewDead?.isPositive() ? crewDead : null;
  const missing = crewMissing?.isPositive() ? crewMissing : null;
  return dead != null || missing != null ? { dead, missing } : null;
}

/** A terminated craft's crew as the roster words it: "2 missing", "1 dead · 1 missing". */
function endedCrewLabel({ dead, missing }: EndedCrew) {
  const parts: string[] = [];
  if (dead != null) parts.push(`${writeQuantity(dead, { decimals: 0 })} dead`);
  if (missing != null) {
    parts.push(`${writeQuantity(missing, { decimals: 0 })} missing`);
  }
  return parts.join(" · ");
}

/**
 * A craft's crew as the centre last heard it: the count as it is while the
 * centre is in contact, marked "?" and spoken as last heard while it is not,
 * and struck through once the craft is declared lost or destroyed, spoken as
 * lost when its last report said so and as presumed lost otherwise. A craft
 * the player ended from the Tracking Station is worded from its crew's roster
 * status instead, as dead or missing.
 */
export function CrewFigure({ vessel }: { vessel: FleetVessel }) {
  const label = crewLabel(vessel);
  const crew = vessel.crew;
  const ended = endedCrew(vessel);
  if (ended != null) {
    return (
      <span
        data-crew-known="terminated"
        style={{ color: ended.dead != null ? TONE_TEXT.nogo : TONE_TEXT.warn }}
      >
        {endedCrewLabel(ended)}
      </span>
    );
  }
  if (crew == null || crew === CatalogCrew.Known) {
    return <>{label}</>;
  }
  if (crew === CatalogCrew.Unknown) {
    return (
      <span
        data-crew-known={KNOWN_AS[crew]}
        style={{ color: TONE_TEXT.neutral }}
      >
        {label}
        <span aria-hidden="true">?</span>
        <VisuallyHidden> crew as last heard</VisuallyHidden>
      </span>
    );
  }
  return (
    <span data-crew-known={KNOWN_AS[crew]} style={{ color: TONE_TEXT.nogo }}>
      <span style={{ textDecoration: "line-through" }}>{label}</span>
      <VisuallyHidden>
        {crew === CatalogCrew.Lost ? " crew lost" : " crew presumed lost"}
      </VisuallyHidden>
    </span>
  );
}
