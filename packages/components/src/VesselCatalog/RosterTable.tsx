import {
  Cluster,
  EmptyState,
  Grid,
  NULL_DISPLAY,
  Stack,
  Text,
  Tooltip,
  Truncate,
  useSlotBound,
} from "@ksp-gonogo/ui-kit";
import { Fragment } from "react";
import { CrewFigure } from "./CrewFigure";
import { COMMS, COMMS_TONE } from "./comms";
import { DismissEnded, type DismissVessel } from "./DismissEnded";
import { useContactBadge } from "./FleetContactCell";
import { FleetSignalCell } from "./FleetSignalCell";
import type { FleetVessel } from "./fleet";
import { ColLabel, LinkDot, LinkDotSpacer } from "./RosterCells";
import { UpdatesRow } from "./UpdatesRow";
import { CatalogUpdates } from "./VesselCatalogEntry";

const ROW_HEIGHT = 25;
const GRID_FULL = "minmax(0, 1fr) auto 48px 66px";
const GRID_COMPACT = "minmax(0, 1fr)";
const NAME_CELL_STYLE = { gap: "7px", padding: "var(--inset-roster-cell)" };

/** A vessel's contact badge on its own line, indented past the link dot so it starts under the name, with the control that dismisses a destroyed craft; renders nothing while there is no badge. */
function ContactLine({
  vessel: v,
  onDismiss,
}: {
  vessel: FleetVessel;
  onDismiss: DismissVessel;
}) {
  const badge = useContactBadge(v.contact, v.name);
  if (badge == null) return null;
  return (
    <Cluster
      justify="start"
      align="center"
      style={{
        ...NAME_CELL_STYLE,
        paddingBottom: "var(--gutter-roster-cell)",
      }}
    >
      <LinkDotSpacer />
      {badge}
      <DismissEnded vessel={v} onDismiss={onDismiss} />
    </Cluster>
  );
}

function RosterRow({
  vessel: v,
  compact,
  showUpdates,
  contactHeld,
  onDismiss,
}: {
  vessel: FleetVessel;
  compact: boolean;
  showUpdates: boolean;
  contactHeld: boolean;
  onDismiss: DismissVessel;
}) {
  const comms = COMMS[v.comms];
  return (
    <>
      <Grid
        cols={compact ? GRID_COMPACT : GRID_FULL}
        gap="related-dense"
        style={compact ? { minHeight: ROW_HEIGHT } : { height: ROW_HEIGHT }}
      >
        <Tooltip text={v.name} announce={false}>
          <Cluster justify="start" align="center" style={NAME_CELL_STYLE}>
            <LinkDot tone={COMMS_TONE[v.comms]} aria-label={comms.aria} />
            {compact ? (
              <Stack style={{ flex: 1, minWidth: 0 }}>
                <Truncate
                  style={{
                    fontSize: "var(--font-size-value)",
                    color: "var(--color-text-primary)",
                  }}
                >
                  {v.name}
                </Truncate>
                <Cluster justify="between" align="center" wrap={false}>
                  <Truncate
                    style={{
                      fontSize: "var(--font-size-caption)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {v.body ?? NULL_DISPLAY} · <CrewFigure vessel={v} />
                  </Truncate>
                  <FleetSignalCell
                    guid={v.id}
                    vesselName={v.name}
                    tone={COMMS_TONE[v.comms]}
                    label={comms.label}
                    contact={v.contact}
                    contactHeld={contactHeld}
                  />
                </Cluster>
              </Stack>
            ) : (
              <Truncate
                style={{
                  fontSize: "var(--font-size-value)",
                  color: "var(--color-text-primary)",
                }}
              >
                {v.name}
              </Truncate>
            )}{" "}
          </Cluster>
        </Tooltip>
        {!compact && (
          <Tooltip text={v.body ?? undefined} focusable>
            <Truncate
              style={{
                fontSize: "var(--font-size-compact)",
                color: "var(--color-text-muted)",
                padding: "var(--inset-roster-cell)",
              }}
            >
              {v.body ?? NULL_DISPLAY}
            </Truncate>
          </Tooltip>
        )}
        {!compact && (
          <Text
            size="sm"
            style={{
              textAlign: "right",
              padding: "var(--inset-roster-cell)",
              whiteSpace: "nowrap",
            }}
          >
            <CrewFigure vessel={v} />
          </Text>
        )}
        {!compact && (
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
              contact={v.contact}
              contactHeld={contactHeld}
            />
          </div>
        )}
      </Grid>
      <ContactLine vessel={v} onDismiss={onDismiss} />
      {showUpdates && (
        <UpdatesRow>
          <CatalogUpdates vessel={v} compact={compact} />
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
  contactHeld,
  onDismiss,
}: {
  known: boolean;
  vessels: FleetVessel[];
  /** Narrow widths fold Body, Crew and Link under the vessel name; height never gates columns, the list scrolls. */
  compact: boolean;
  /** Whether the catalog the rows came from has stopped arriving, so each row's contact is the last known. */
  contactHeld: boolean;
  /** Takes a destroyed craft off the catalog: see `useDismissEnded`. */
  onDismiss: DismissVessel;
}) {
  // Not gated on `compact`: the augment sheds detail at narrow widths itself, so a critical alarm never vanishes.
  const showUpdates = useSlotBound("vessel-catalog.updates");
  if (vessels.length === 0) {
    return (
      <EmptyState>
        {known ? "No vessels tracked" : "Fleet data not available yet"}
      </EmptyState>
    );
  }
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
        {!compact && <ColLabel right>Crew</ColLabel>}
        {!compact && <ColLabel right>Link</ColLabel>}
      </Grid>

      {vessels.map((v) => (
        <Fragment key={v.id}>
          <RosterRow
            vessel={v}
            compact={compact}
            showUpdates={showUpdates}
            contactHeld={contactHeld}
            onDismiss={onDismiss}
          />
        </Fragment>
      ))}
    </>
  );
}
