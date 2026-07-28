import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getAugmentsForSlot,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type StreamStatusValue,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import { RosterCommsControlSource, VesselType } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  EmptyState,
  Meter,
  Panel,
  PanelTitle,
  StreamStatusBadge,
} from "@ksp-gonogo/ui";
import { Fragment, useCallback, useMemo, useSyncExternalStore } from "react";
import styled from "styled-components";

type FleetRosterConfig = Record<string, never>;

// ---------------------------------------------------------------------------
// Data read
//
// The whole roster rides the single `system.vessels` Topic (every known
// vessel, loaded or not — KspHost.BuildVesselRosterEntry's capture-add), NOT
// a legacy `fleet.vessels` DataSource key. `system.bodies` resolves each
// entry's `bodyIndex` to a display name, the same pattern SystemView already
// uses for its own vessel-body lookups. Copy of TargetPicker/DistanceToTarget/
// OrbitView/LandingStatus's own local `useStreamStatusOptional` — there is no
// shared export of it yet.
//
// `system.vessels` is intentionally unfiltered at the source: it enumerates
// EVERY vessel KSP tracks (craft, debris, asteroids/comets, planted flags,
// EVA kerbals, deployed science hardware), because other consumers of the
// same Topic (TargetPicker, in particular) legitimately want the non-craft
// entries too - e.g. picking an asteroid as a rendezvous target. A fleet
// roster is a different question ("what do I fly"), so `isRosterCraft`
// below filters client-side, in this widget, rather than mod-side in the
// capture. Stripping non-craft rows out of `system.vessels` itself would
// break every other consumer of the shared topic.
// ---------------------------------------------------------------------------

/**
 * Real, flyable craft: `Ship`/`Station`/`Lander`/`Probe`/`Rover`/`Base`/
 * `Relay`. Everything else `VesselType` can hold is structurally NOT a fleet
 * vessel an operator means when they say "Fleet":
 *  - `Debris` and `SpaceObject` (asteroids/comets) never get a `CommNetVessel`
 *    attached at all - verified against `CommNet.CommNetVessel.OnStart`
 *    (decompile) - a permanent, by-design exclusion, not a data gap.
 *  - `EVA` is a kerbal outside a craft, `Flag` is a planted flag, and
 *    `DeployedScienceController`/`DeployedSciencePart`/`DroppedPart` are
 *    stationary deployed hardware - none of these are vehicles either.
 *
 * Ordinals are Sitrep.Contract's OWN declared order (`VesselEnums.cs`), not
 * stock KSP's - reading off the generated `VesselType` enum (not a bare
 * numeric literal) is what keeps this safe if that order ever changes.
 */
const CRAFT_VESSEL_TYPES: ReadonlySet<VesselType> = new Set([
  VesselType.Ship,
  VesselType.Station,
  VesselType.Lander,
  VesselType.Probe,
  VesselType.Rover,
  VesselType.Base,
  VesselType.Relay,
]);

/**
 * `VesselType.Unknown` is deliberately NOT filtered out. It means the
 * producer itself couldn't classify the vessel this tick (a raw KSP
 * `VesselType` string the mapper doesn't recognize, see
 * `VesselViewProvider.ParseVesselType`'s own fallback), not "this is
 * confirmed to not be a craft" the way `Debris`/`SpaceObject`/etc. are. An
 * unclassified vessel silently disappearing from the roster would be the
 * same class of bug this widget already fixed once for its empty state: a
 * real "we don't know" fact reported as nothing at all. It renders through
 * the roster's existing null-safe row handling (body/crew fall back to the
 * usual null placeholder, comms shows the "unknown" tier) rather than
 * getting a fabricated craft identity.
 */
function isRosterCraft(vesselType: VesselType): boolean {
  return (
    vesselType === VesselType.Unknown || CRAFT_VESSEL_TYPES.has(vesselType)
  );
}

function useStreamStatusOptional(topic: string): StreamStatusValue {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) return () => {};
      const inputTopics = store.resolveSubscriptionTopics(topic);
      const unsubscribeInputs = inputTopics.map((inputTopic) =>
        client.subscribe(inputTopic, () => {}),
      );
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        for (const unsubscribe of unsubscribeInputs) unsubscribe();
      };
    },
    [client, store, topic],
  );
  const getSnapshot = useCallback((): StreamStatusValue => {
    if (!store) return "disconnected";
    return store.sampleStatus(topic, store.currentFrame());
  }, [store, topic]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * `"unknown"` is a REAL, honestly-reported tier, not a client-side fallback —
 * the producer itself emits a null `commsControlSource` whenever CommNet had
 * nothing to read for that vessel this tick (see `VesselRosterEntry`'s own
 * doc comment), and this is that null carried through to the row. It must
 * never be presented the same as `"none"` (a confirmed no-link vessel is a
 * real ops fact; an unread vessel is not).
 */
type CommsLink = "connected" | "relay" | "none" | "unknown";

interface FleetVessel {
  /** Stable vessel id — the row key and the line-updates slot correlation key. */
  id: string;
  name: string;
  /** Body the vessel orbits/sits on, resolved via `system.bodies`; null when unresolved. */
  body: string | null;
  /** Kerbals aboard; null when the producer could not read it this tick (never a fabricated 0). */
  crewCount: number | null;
  /** Seat capacity; null under the same condition as `crewCount`. */
  crewCapacity: number | null;
  comms: CommsLink;
}

function rosterCommsLink(
  source: RosterCommsControlSource | null | undefined,
): CommsLink {
  switch (source) {
    case RosterCommsControlSource.Full:
      return "connected";
    case RosterCommsControlSource.Partial:
      return "relay";
    case RosterCommsControlSource.None:
      return "none";
    default:
      return "unknown";
  }
}

/**
 * `system.vessels` -> the widget's row shape. `known` distinguishes "the
 * topic has never delivered a sample" from "it delivered one, and the fleet
 * is genuinely empty" — the same distinction the FleetRoster stub fix
 * established, now against the real Topic instead of the retired
 * `fleet.vessels` key.
 */
function useFleet(): { known: boolean; vessels: FleetVessel[] } {
  const system = useTelemetry("system.vessels");
  const bodies = useTelemetry("system.bodies");

  const nameByIndex = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of bodies?.bodies ?? []) {
      if (b.name != null) m.set(b.index, b.name);
    }
    return m;
  }, [bodies]);

  const vessels = useMemo<FleetVessel[]>(
    () =>
      (system?.vessels ?? [])
        .filter((v) => isRosterCraft(v.vesselType))
        .map((v) => ({
          id: v.vesselId,
          name: v.name,
          body:
            v.bodyIndex != null ? (nameByIndex.get(v.bodyIndex) ?? null) : null,
          crewCount: v.crewCount ?? null,
          crewCapacity: v.crewCapacity ?? null,
          comms: rosterCommsLink(v.commsControlSource),
        })),
    [system, nameByIndex],
  );

  return { known: system !== undefined, vessels };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tone = "go" | "info" | "warn" | "nogo" | "neutral";

// NOTE: these are used as a single foreground color (dot fill, tag border
// AND tag text) below, not a background fill, so "info" deliberately reads
// off `-fg` rather than `-bg` - `--color-status-info-bg` is a near-black
// background-fill token that renders invisibly as foreground/border/text
// against this widget's dark panel. go/warn/nogo's `-bg` tokens happen to
// already be saturated enough to read fine in that same role.
const TONE_HEX: Record<Tone, string> = {
  go: "var(--color-status-go-bg)",
  info: "var(--color-status-info-fg)",
  warn: "var(--color-status-warning-bg)",
  nogo: "var(--color-status-nogo-bg)",
  neutral: "var(--color-text-muted)",
};

/** Comms tier -> tone. This is the ONLY per-row signal the roster has a real
 *  read for — there is no vessel-health/reliability tone here (see the
 *  widget registration's own note on why `status` was dropped). */
const COMMS_TONE: Record<CommsLink, Tone> = {
  connected: "go",
  relay: "info",
  none: "nogo",
  unknown: "neutral",
};

/** Compact comms label + tone + a full accessible name. */
const COMMS: Record<CommsLink, { label: string; aria: string }> = {
  connected: { label: "DIRECT", aria: "Direct link" },
  relay: { label: "RELAY", aria: "Relay link" },
  none: { label: "NONE", aria: "No link" },
  unknown: { label: "—", aria: "Link state unknown" },
};

function crewLabel(v: FleetVessel): string {
  if (v.crewCount == null) return "—";
  if (v.crewCount === 0 && v.crewCapacity == null) return "0";
  return v.crewCapacity != null
    ? `${v.crewCount}/${v.crewCapacity}`
    : String(v.crewCount);
}

/**
 * Fleet-wide comms rollup — the header badge + footer meter both read off
 * this. Deliberately worded around LINK, never "nominal"/"critical": those
 * words would read as a reliability/health verdict this widget has no data
 * to back (see the module doc comment on why `status` isn't a thing here).
 */
function commsRollup(vessels: FleetVessel[]): {
  linked: number;
  none: number;
  unknown: number;
  badgeLabel: string;
  tone: Tone;
} {
  const linked = vessels.filter(
    (v) => v.comms === "connected" || v.comms === "relay",
  ).length;
  const none = vessels.filter((v) => v.comms === "none").length;
  const unknown = vessels.filter((v) => v.comms === "unknown").length;

  let badgeLabel: string;
  let tone: Tone;
  if (vessels.length === 0) {
    badgeLabel = "No Vessels";
    tone = "neutral";
  } else if (none === 0 && unknown === 0) {
    badgeLabel = "All Linked";
    tone = "go";
  } else if (linked === 0) {
    badgeLabel = "No Link";
    tone = "nogo";
  } else {
    badgeLabel = `${none + unknown} Not Linked`;
    tone = "warn";
  }
  return { linked, none, unknown, badgeLabel, tone };
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 25;

function FleetRosterComponent({
  w,
}: Readonly<ComponentProps<FleetRosterConfig>>) {
  const { known, vessels } = useFleet();
  const streamStatus = useStreamStatusOptional("system.vessels");
  const rollup = commsRollup(vessels);
  const cols = w ?? 8;
  // Below the width threshold the Body column and the per-vessel update lines
  // are shed — the identity + crew + link (the at-a-glance fleet state) always
  // stay. Height doesn't gate columns; the list just scrolls.
  const compact = cols < 6;

  // Non-reactive read — augments register at module load, before first render.
  const updatesAugmentPresent =
    getAugmentsForSlot("fleet-roster.updates").length > 0;

  const total = vessels.length;

  return (
    <Panel>
      <HeaderRow>
        <PanelTitle>Fleet</PanelTitle>
        <TitleRight>
          <Badge tone={rollup.tone}>{rollup.badgeLabel}</Badge>
          <StreamStatusBadge status={streamStatus} />
        </TitleRight>
      </HeaderRow>

      {total === 0 ? (
        <EmptyState>
          {known ? "No vessels tracked." : "Fleet data not available yet."}
        </EmptyState>
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
            // The per-vessel line-updates block is PURELY the
            // `fleet-roster.updates` augment slot now — the seam for a
            // future Reliability/TestFlight uplink to compose real
            // alarm/health one-liners here. It carries no data of its own
            // (there is no reliability signal behind this widget; see the
            // module doc comment), so it renders nothing until an uplink
            // actually registers.
            const showUpdates = !compact && updatesAugmentPresent;
            return (
              <Fragment key={v.id}>
                <Row $compact={compact}>
                  <NameCell title={v.name}>
                    <LinkDot
                      $tone={COMMS_TONE[v.comms]}
                      role="img"
                      aria-label={comms.aria}
                    />
                    <Name>{v.name}</Name>
                  </NameCell>
                  {!compact && (
                    <BodyCell title={v.body ?? undefined}>
                      {v.body ?? "—"}
                    </BodyCell>
                  )}
                  <CrewCell>{crewLabel(v)}</CrewCell>
                  <LinkCell>
                    <CommsTag
                      $tone={COMMS_TONE[v.comms]}
                      aria-label={comms.aria}
                    >
                      {comms.label}
                    </CommsTag>
                  </LinkCell>
                </Row>
                {showUpdates && (
                  <UpdatesBlock>
                    <AugmentSlot
                      name="fleet-roster.updates"
                      props={{
                        vesselId: v.id,
                        vesselName: v.name,
                        body: v.body ?? "",
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
          label="Comms coverage"
          value={total > 0 ? rollup.linked / total : 0}
          tone={rollup.tone}
          valueLabel={`${rollup.linked} linked · ${rollup.none} no link${
            rollup.unknown > 0 ? ` · ${rollup.unknown} unknown` : ""
          }`}
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

const TitleRight = styled.div`
  display: inline-flex;
  align-items: center;
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

const LinkDot = styled.span<{ $tone: Tone }>`
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
    "Fleet-wide roster table: one row per known CRAFT (debris, asteroids/comets, flags, EVA kerbals, and deployed science hardware are filtered out, see isRosterCraft) with name, body, crew, and comms link tier (direct/relay/no link), plus a fleet-wide comms-coverage summary. There is no per-vessel reliability/health signal behind this widget (reliability.summary is active-vessel-only) - the fleet-roster.updates augment slot is the seam for a future Reliability/TestFlight uplink to add that. The spatial fleet view lives in SystemView.",
  tags: ["telemetry", "kerbalism"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 4, h: 4 },
  component: FleetRosterComponent,
  dataRequirements: ["system.vessels", "system.bodies"],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
});

export type { CommsLink, FleetVessel };
export { FleetRosterComponent };
