import { AugmentSlot } from "@ksp-gonogo/core";
import { Cluster, Grid, Stack } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { CrewFigure } from "./CrewFigure";
import { COMMS, COMMS_TONE } from "./comms";
import { DismissEnded, type DismissVessel } from "./DismissEnded";
import { useContactBadge } from "./FleetContactCell";
import { FleetSignalCell } from "./FleetSignalCell";
import { type FleetVessel, useFleet } from "./fleet";

/** The `vessel-catalog.updates` slot for one craft, so every place that shows a craft's catalog entry passes the augments the same props. */
export function CatalogUpdates({
  vessel,
  compact,
}: {
  vessel: FleetVessel;
  compact: boolean;
}) {
  return (
    <AugmentSlot
      name="vessel-catalog.updates"
      props={{
        vesselId: vessel.id,
        vesselName: vessel.name,
        body: vessel.body ?? "",
        compact,
      }}
    />
  );
}

/** One craft's catalog entry and whether the catalog it came from has stopped arriving; null while the catalog does not list it as a craft. */
export function useCatalogVessel(
  vesselId: string | null,
): { vessel: FleetVessel; contactHeld: boolean } | null {
  const { reading, vessels } = useFleet();
  const vessel =
    vesselId === null ? undefined : vessels.find((v) => v.id === vesselId);
  if (vessel === undefined) return null;
  return { vessel, contactHeld: reading.state === "held" };
}

/**
 * One craft's Vessel Catalog entry laid out as a column: its contact with the
 * command centre, or how it learned the craft was destroyed with the control
 * that dismisses it, what the centre knows of its crew, its link with the signal
 * delay behind it, and the Uplinks' updates for it. Useful for showing the operator what the catalog knows of a
 * craft beside a picture of it. Used by the Tracking Station's side bar for the
 * selected craft.
 */
export function VesselCatalogEntry({
  vessel,
  contactHeld,
  onDismiss,
}: {
  vessel: FleetVessel;
  /** Whether the catalog the entry came from has stopped arriving, so its contact is the last known. */
  contactHeld: boolean;
  /** Takes the craft off the catalog once it is destroyed: see `useDismissEnded`. Without it no dismissal is offered. */
  onDismiss?: DismissVessel;
}) {
  const badge = useContactBadge(vessel.contact, vessel.name);
  const comms = COMMS[vessel.comms];
  return (
    <Stack gap="related">
      {badge && (
        <Cluster justify="start" align="center">
          {badge}
          <DismissEnded vessel={vessel} onDismiss={onDismiss} />
        </Cluster>
      )}
      {vessel.crew != null && (
        <Grid cols="1fr auto" gap="label-value" align="baseline">
          <span style={LABEL}>Crew</span>
          <span style={VALUE}>
            <CrewFigure vessel={vessel} />
          </span>
        </Grid>
      )}
      <Grid cols="1fr auto" gap="label-value" align="baseline">
        <span style={LABEL}>Link</span>
        <FleetSignalCell
          guid={vessel.id}
          vesselName={vessel.name}
          tone={COMMS_TONE[vessel.comms]}
          label={comms.label}
          contact={vessel.contact}
          contactHeld={contactHeld}
        />
      </Grid>
      <CatalogUpdates vessel={vessel} compact />
    </Stack>
  );
}

const LABEL: CSSProperties = { color: "var(--color-text-faint)" };

const VALUE: CSSProperties = {
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
};
