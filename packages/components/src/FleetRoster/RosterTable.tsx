import { AugmentSlot, getAugmentsForSlot } from "@ksp-gonogo/core";
import {
  Cluster,
  EmptyState,
  Grid,
  NULL_DISPLAY,
  Text,
  Truncate,
} from "@ksp-gonogo/ui-kit";
import { Fragment } from "react";
import { COMMS, COMMS_TONE } from "./comms";
import { FleetContactCell } from "./FleetContactCell";
import { FleetSignalCell } from "./FleetSignalCell";
import { crewLabel, type FleetVessel } from "./fleet";
import { ColLabel, LinkDot } from "./RosterCells";
import { UpdatesRow } from "./UpdatesRow";

const ROW_HEIGHT = 25;
const GRID_FULL = "minmax(0, 1fr) auto 48px 66px";
const GRID_COMPACT = "minmax(0, 1fr) 48px 66px";

function RosterRow({
  vessel: v,
  compact,
  showUpdates,
}: {
  vessel: FleetVessel;
  compact: boolean;
  showUpdates: boolean;
}) {
  const comms = COMMS[v.comms];
  return (
    <>
      <Grid
        cols={compact ? GRID_COMPACT : GRID_FULL}
        gap="related-dense"
        style={{ height: ROW_HEIGHT }}
      >
        <Cluster
          justify="start"
          align="center"
          title={v.name}
          style={{
            gap: "7px",
            padding: "var(--inset-roster-cell)",
          }}
        >
          <LinkDot tone={COMMS_TONE[v.comms]} ariaLabel={comms.aria} />
          <Truncate
            style={{
              fontSize: "var(--font-size-value)",
              color: "var(--color-text-primary)",
            }}
          >
            {v.name}
          </Truncate>
          <FleetContactCell guid={v.id} vesselName={v.name} />
        </Cluster>
        {!compact && (
          <Truncate
            title={v.body ?? undefined}
            style={{
              fontSize: "var(--font-size-compact)",
              color: "var(--color-text-muted)",
              padding: "var(--inset-roster-cell)",
            }}
          >
            {v.body ?? NULL_DISPLAY}
          </Truncate>
        )}
        <Text
          tone="default"
          size="sm"
          style={{
            textAlign: "right",
            padding: "var(--inset-roster-cell)",
            whiteSpace: "nowrap",
          }}
        >
          {crewLabel(v)}
        </Text>
        <div
          style={{
            padding: "var(--inset-roster-cell)",
            textAlign: "right",
          }}
        >
          <FleetSignalCell
            guid={v.id}
            vesselName={v.name}
            tone={COMMS_TONE[v.comms]}
            label={comms.label}
          />
        </div>
      </Grid>
      {showUpdates && (
        <UpdatesRow>
          <AugmentSlot
            name="fleet-roster.updates"
            props={{
              vesselId: v.id,
              vesselName: v.name,
              body: v.body ?? "",
              compact,
            }}
          />
        </UpdatesRow>
      )}
    </>
  );
}

/** The roster table, or the empty state when there is nothing to list. */
export function RosterTable({
  known,
  vessels,
  compact,
}: {
  known: boolean;
  vessels: FleetVessel[];
  /** Narrow widths shed the Body column; height never gates columns, the list scrolls. */
  compact: boolean;
}) {
  if (vessels.length === 0) {
    return (
      <EmptyState>
        {known ? "No vessels tracked." : "Fleet data not available yet."}
      </EmptyState>
    );
  }
  // Non-reactive read, augments register at module load, before first render. Not gated on `compact`: the augment sheds detail at narrow widths itself, so a critical alarm never vanishes.
  const showUpdates = getAugmentsForSlot("fleet-roster.updates").length > 0;
  return (
    <>
      <Grid
        cols={compact ? GRID_COMPACT : GRID_FULL}
        gap="related-dense"
        align="center"
        style={{
          height: ROW_HEIGHT,
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <ColLabel>Vessel</ColLabel>
        {!compact && <ColLabel>Body</ColLabel>}
        <ColLabel right>Crew</ColLabel>
        <ColLabel right>Link</ColLabel>
      </Grid>

      {vessels.map((v) => (
        <Fragment key={v.id}>
          <RosterRow vessel={v} compact={compact} showUpdates={showUpdates} />
        </Fragment>
      ))}
    </>
  );
}
