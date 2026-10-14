import { readingOf, useTrackedVesselLink } from "@ksp-gonogo/sitrep-client";
import {
  CatalogContact,
  delayVisibility,
  stillTrue,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { HoverCard, Unit } from "@ksp-gonogo/ui-kit";
import type { Tone } from "./comms";
import type { FleetContact } from "./fleet";
import { CommsTag } from "./RosterCells";

function linkStateLabel(reachable: boolean | null, held: boolean): string {
  if (reachable == null) return "unknown";
  const state = reachable ? "connected" : "no path";
  return held ? `${state} (last known)` : state;
}

const TERM_STYLE = {
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.05em",
} as const;

const DEFINITION_STYLE = {
  margin: 0,
  color: "var(--color-text-primary)",
} as const;

/**
 * The per-row Link cell: hovering or focusing the connectivity tag shows this vessel's reachability and signal delay.
 * Reachability comes only off the catalog's contact: the last `.link` payload before a blackout still says `connected: true`, so its `connected` is never read.
 */
export function FleetSignalCell({
  guid,
  vesselName,
  tone,
  label,
  contact,
  contactHeld,
}: {
  guid: string;
  vesselName: string;
  tone: Tone;
  label: string;
  contact: FleetContact;
  /** Whether the catalog the contact came from has stopped arriving, so it is the last known. */
  contactHeld: boolean;
}) {
  const linkReading = useTrackedVesselLink(guid);
  const link = stillTrue(linkReading, undefined);
  const oneWay = link?.oneWaySeconds ?? null;
  // One read of reachability, so the Link term and the Delay label cannot disagree.
  const reachable =
    contact.contact == null
      ? null
      : contact.contact === CatalogContact.InContact;
  // A light-time from before the link dropped, or one that stopped arriving, is still worth showing but is not a present reading.
  const heldOver =
    reachable === false || contactHeld || linkReading.state === "held";
  // The row draws only once `oneWay` is known, so the zero fallback is never on screen.
  const oneWayReading = readingOf(linkReading, (l) =>
    value("s", l.oneWaySeconds ?? 0),
  );
  const roundTripReading = readingOf(linkReading, (l) =>
    value("s", 2 * (l.oneWaySeconds ?? 0)),
  );
  return (
    <HoverCard
      aria-label={`${vesselName} signal`}
      trigger={<CommsTag tone={tone}>{label}</CommsTag>}
    >
      <dl
        style={{
          margin: 0,
          display: "grid",
          gap: "var(--gap-related)",
          fontSize: "var(--font-size-compact)",
          whiteSpace: "nowrap",
        }}
      >
        <div>
          <dt style={TERM_STYLE}>Link</dt>
          <dd style={DEFINITION_STYLE}>
            {linkStateLabel(reachable, contactHeld)}
          </dd>
        </div>
        {delayVisibility(oneWay) === "shown" && (
          <div>
            <dt style={TERM_STYLE}>
              {heldOver ? "Delay (last known)" : "Delay"}
            </dt>
            <dd style={DEFINITION_STYLE}>
              one-way ~<Unit value={oneWayReading} decimals={1} /> · round-trip
              ~
              <Unit value={roundTripReading} decimals={1} />
            </dd>
          </div>
        )}
      </dl>
    </HoverCard>
  );
}
