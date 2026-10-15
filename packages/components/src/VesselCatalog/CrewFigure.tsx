import { CatalogCrew } from "@ksp-gonogo/sitrep-sdk";
import { VisuallyHidden } from "@ksp-gonogo/ui-kit";
import { TONE_TEXT } from "./comms";
import { crewLabel, type FleetVessel } from "./fleet";

const KNOWN_AS: Record<CatalogCrew, string> = {
  [CatalogCrew.Known]: "known",
  [CatalogCrew.Unknown]: "unknown",
  [CatalogCrew.PresumedLost]: "presumed-lost",
};

/**
 * A craft's crew as the centre last heard it: the count as it is while the
 * centre is in contact, marked "?" and spoken as last heard while it is not,
 * and struck through once the craft is declared lost.
 */
export function CrewFigure({ vessel }: { vessel: FleetVessel }) {
  const label = crewLabel(vessel);
  const crew = vessel.crew;
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
      <VisuallyHidden> crew presumed lost</VisuallyHidden>
    </span>
  );
}
