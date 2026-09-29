import {
  readingOf,
  useFleetVesselContact,
  useFleetVesselLink,
} from "@ksp-gonogo/sitrep-client";
import { stillTrue, value } from "@ksp-gonogo/sitrep-sdk";
import { HoverCard, Unit } from "@ksp-gonogo/ui-kit";
import type { Tone } from "./comms";
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
 * Reachability comes only off freeze-exempt `.contact`: the last `.delay` payload before a blackout still says `connected: true`, so its `connected` is never read.
 */
export function FleetSignalCell({
  guid,
  vesselName,
  tone,
  label,
}: {
  guid: string;
  vesselName: string;
  tone: Tone;
  label: string;
}) {
  const contactReading = useFleetVesselContact(guid);
  const linkReading = useFleetVesselLink(guid);
  const contact = stillTrue(contactReading, undefined);
  const link = stillTrue(linkReading, undefined);
  const oneWay = link?.oneWaySeconds ?? null;
  // One read of reachability, so the Link term and the Delay label cannot disagree.
  const reachable = contact == null ? null : contact.connected === true;
  // A reachability that has stopped arriving is the last one known, and says so.
  const contactHeld = contactReading.state === "held";
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
      ariaLabel={`${vesselName} signal`}
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
        {oneWay != null && (
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
