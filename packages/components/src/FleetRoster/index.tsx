import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getAugmentsForSlot,
  registerComponent,
  useDataSourceSubscription,
} from "@ksp-gonogo/core";
import { Badge, EmptyState, Meter, Panel, PanelTitle } from "@ksp-gonogo/ui";
import { Fragment } from "react";
import styled from "styled-components";

type FleetRosterConfig = Record<string, never>;

// ---------------------------------------------------------------------------
// Data read
//
// `fleet.vessels` is ONE object key carrying the whole roster as a JSON array
// (not flat per-field keys) — the fleet is variable-length, so a single array
// value is the natural shape. For the offline render the probe emits it on the
// "data" source; when the real KerbalismUplink Topic lands, swap `useFleet` to
// read `useTelemetry("fleet")`. The table below never changes — this hook is the
// data boundary.
// ---------------------------------------------------------------------------

function useRaw<T>(key: string): T | undefined {
  return useDataSourceSubscription<T | undefined>(
    "data",
    (source, onStoreChange, snapshotRef) =>
      source.subscribe(key, (v) => {
        snapshotRef.current = v as T;
        onStoreChange();
      }),
    undefined,
  );
}

type VesselStatus = "nominal" | "warn" | "critical";
type CommsLink = "connected" | "relay" | "none";
type UpdateTone = "info" | "warn" | "nogo";

interface FleetUpdate {
  text: string;
  tone?: UpdateTone;
}

interface FleetVessel {
  /** Stable vessel id — the row key and the line-updates slot correlation key. */
  id: string;
  name: string;
  /** Body the vessel is at (orbiting / landed / flying). */
  body: string;
  /** Crew aboard. 0 = uncrewed (probe). */
  crew: number;
  /** Crew capacity, when known — renders as `crew / capacity`. */
  crewCapacity?: number;
  comms: CommsLink;
  status: VesselStatus;
  /** Inline reliability / alarm one-liners. The `fleet-roster.updates` augment
   *  slot composes ALONGSIDE these (see the row) — an uplink contributes more. */
  updates?: FleetUpdate[];
}

function useFleet(): FleetVessel[] {
  return useRaw<FleetVessel[]>("fleet.vessels") ?? [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tone = "go" | "info" | "warn" | "nogo";

const TONE_HEX: Record<Tone, string> = {
  go: "var(--color-status-go-bg)",
  info: "var(--color-status-info-bg)",
  warn: "var(--color-status-warning-bg)",
  nogo: "var(--color-status-nogo-bg)",
};

const STATUS_TONE: Record<VesselStatus, Tone> = {
  nominal: "go",
  warn: "warn",
  critical: "nogo",
};

/** Compact comms label + tone + a full accessible name. */
const COMMS: Record<CommsLink, { label: string; tone: Tone; aria: string }> = {
  connected: { label: "DIRECT", tone: "go", aria: "Direct link" },
  relay: { label: "RELAY", tone: "info", aria: "Relay link" },
  none: { label: "NONE", tone: "nogo", aria: "No link" },
};

function fleetStatus(vessels: FleetVessel[]): { label: string; tone: Tone } {
  if (vessels.some((v) => v.status === "critical"))
    return { label: "Critical", tone: "nogo" };
  if (vessels.some((v) => v.status === "warn"))
    return { label: "Degraded", tone: "warn" };
  return { label: "Nominal", tone: "go" };
}

function crewLabel(v: FleetVessel): string {
  if (v.crew <= 0 && !v.crewCapacity) return "—";
  return v.crewCapacity ? `${v.crew}/${v.crewCapacity}` : String(v.crew);
}

const updateTone = (t: UpdateTone | undefined): Tone => t ?? "info";

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 25;

function FleetRosterComponent({
  w,
}: Readonly<ComponentProps<FleetRosterConfig>>) {
  const vessels = useFleet();
  const status = fleetStatus(vessels);
  const cols = w ?? 8;
  // Below the width threshold the Body column and the per-vessel update lines
  // are shed — the identity + crew + link (the at-a-glance fleet state) always
  // stay. Height doesn't gate columns; the list just scrolls.
  const compact = cols < 6;

  // Non-reactive read — augments register at module load, before first render.
  const updatesAugmentPresent =
    getAugmentsForSlot("fleet-roster.updates").length > 0;

  const total = vessels.length;
  const nominal = vessels.filter((v) => v.status === "nominal").length;
  const warn = vessels.filter((v) => v.status === "warn").length;
  const critical = vessels.filter((v) => v.status === "critical").length;
  const readiness = total > 0 ? nominal / total : 0;

  return (
    <Panel>
      <HeaderRow>
        <PanelTitle>Fleet</PanelTitle>
        <Badge tone={status.tone}>{status.label}</Badge>
      </HeaderRow>

      {total === 0 ? (
        <EmptyState>No vessels tracked.</EmptyState>
      ) : (
        <TableScroll>
          <ColumnHead $compact={compact}>
            <ColLabel>Vessel</ColLabel>
            {!compact && <ColLabel>Body</ColLabel>}
            <ColLabel $right>Crew</ColLabel>
            <ColLabel $right>Link</ColLabel>
          </ColumnHead>

          {vessels.map((v) => {
            const comms = COMMS[v.comms];
            const rowUpdates = compact ? [] : (v.updates ?? []);
            // The updates block carries inline one-liners AND the
            // `fleet-roster.updates` augment slot. Only render it when there's
            // something to show — inline updates, or a registered augment — so
            // vessels with a clean bill don't leave an empty gap.
            const showUpdates =
              !compact && (rowUpdates.length > 0 || updatesAugmentPresent);
            return (
              <Fragment key={v.id}>
                <Row $compact={compact}>
                  <NameCell title={v.name}>
                    <StatusDot
                      $tone={STATUS_TONE[v.status]}
                      role="img"
                      aria-label={`${v.status} status`}
                    />
                    <Name>{v.name}</Name>
                  </NameCell>
                  {!compact && <BodyCell title={v.body}>{v.body}</BodyCell>}
                  <CrewCell>{crewLabel(v)}</CrewCell>
                  <LinkCell>
                    <CommsTag $tone={comms.tone} aria-label={comms.aria}>
                      {comms.label}
                    </CommsTag>
                  </LinkCell>
                </Row>
                {showUpdates && (
                  <UpdatesBlock>
                    {rowUpdates.map((u, i) => (
                      <UpdateLine
                        // biome-ignore lint/suspicious/noArrayIndexKey: updates are order-stable one-liners with no id
                        key={i}
                      >
                        <UpdateDot $tone={updateTone(u.tone)} />
                        <UpdateText $tone={updateTone(u.tone)}>
                          {u.text}
                        </UpdateText>
                      </UpdateLine>
                    ))}
                    {/* Reliability / alarm one-liners from other uplinks compose
                        here per vessel — empty until one registers. */}
                    <AugmentSlot
                      name="fleet-roster.updates"
                      props={{
                        vesselId: v.id,
                        vesselName: v.name,
                        body: v.body,
                      }}
                    />
                  </UpdatesBlock>
                )}
              </Fragment>
            );
          })}
        </TableScroll>
      )}

      <FooterRow>
        <Meter
          label="Fleet readiness"
          value={readiness}
          tone={status.tone}
          valueLabel={`${nominal} nominal · ${warn} warn · ${critical} critical`}
          size={compact ? "sm" : "md"}
        />
      </FooterRow>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Styles
//
// A CSS-grid "table": the header and every vessel row share one
// grid-template-columns so the columns line up, with the name column taking
// the flexible `1fr` (minmax(0,…) so long names ellipsis instead of pushing
// the fixed columns off-screen).
// ---------------------------------------------------------------------------

// Name takes the flexible 1fr; Body is content-sized (short body names don't
// need a fixed slice), Crew/Link are just wide enough for their content — so the
// vessel name keeps the most room at the tight 8-wide default.
const GRID_FULL = "minmax(0, 1fr) auto 42px 66px";
const GRID_COMPACT = "minmax(0, 1fr) 42px 66px";

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const TableScroll = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  margin-top: 6px;
`;

const ColumnHead = styled.div<{ $compact: boolean }>`
  display: grid;
  grid-template-columns: ${({ $compact }) =>
    $compact ? GRID_COMPACT : GRID_FULL};
  align-items: center;
  height: ${ROW_HEIGHT}px;
  border-bottom: 1px solid var(--color-border-subtle);
`;

const ColLabel = styled.div<{ $right?: boolean }>`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  padding: 0 6px;
  text-align: ${({ $right }) => ($right ? "right" : "left")};
  white-space: nowrap;
`;

const Row = styled.div<{ $compact: boolean }>`
  display: grid;
  grid-template-columns: ${({ $compact }) =>
    $compact ? GRID_COMPACT : GRID_FULL};
  align-items: center;
  height: ${ROW_HEIGHT}px;
`;

const NameCell = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 0 6px;
`;

const StatusDot = styled.span<{ $tone: Tone }>`
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $tone }) => TONE_HEX[$tone]};
`;

const Name = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const BodyCell = styled.div`
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  padding: 0 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const CrewCell = styled.div`
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  text-align: right;
  padding: 0 6px;
  white-space: nowrap;
`;

const LinkCell = styled.div`
  padding: 0 6px;
  text-align: right;
`;

const CommsTag = styled.span<{ $tone: Tone }>`
  display: inline-block;
  font-size: 10px;
  letter-spacing: 0.05em;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid ${({ $tone }) => TONE_HEX[$tone]};
  color: ${({ $tone }) => TONE_HEX[$tone]};
  white-space: nowrap;
`;

const UpdatesBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 6px 5px 21px;
`;

const UpdateLine = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`;

const UpdateDot = styled.span<{ $tone: Tone }>`
  flex: 0 0 auto;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: ${({ $tone }) => TONE_HEX[$tone]};
`;

const UpdateText = styled.span<{ $tone: Tone }>`
  font-size: var(--font-size-xs);
  color: ${({ $tone }) => TONE_HEX[$tone]};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const FooterRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
  padding-top: 6px;
  flex-shrink: 0;
`;

registerComponent<FleetRosterConfig>({
  id: "fleet-roster",
  name: "Fleet Roster",
  description:
    "Fleet-wide status table: one row per vessel with name, body, crew, comms link state, and a nominal/warn/critical status, plus per-vessel reliability/alarm line-updates and a fleet-readiness summary. The spatial fleet view lives in SystemView.",
  tags: ["telemetry", "kerbalism"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 4, h: 4 },
  component: FleetRosterComponent,
  dataRequirements: ["fleet.vessels"],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
});

export type { CommsLink, FleetUpdate, FleetVessel, VesselStatus };
export { FleetRosterComponent };
