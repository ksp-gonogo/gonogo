import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  getAugmentsForSlot,
  registerComponent,
} from "@ksp-gonogo/core";
import {
  contactPhase,
  overdueSeconds,
  readingOf,
  useFleetVesselContact,
  useFleetVesselLink,
  useFleetVesselSilence,
  useObservedVantage,
  useSelectedVantage,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import {
  combineReadings,
  type Reading,
  RosterCommsControlSource,
  stillTrue,
  type Value,
  VesselType,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Meter } from "@ksp-gonogo/ui";
import {
  Badge,
  Cluster,
  Disclosure,
  EmptyState,
  Grid,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  severityFromBadgeEntryTone,
  Text,
  Truncate,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { Fragment, type ReactNode, useMemo } from "react";
// UpdatesRow needs styled-components for its `:empty` collapse, which an inline style cannot express.
// biome-ignore lint/style/noRestrictedImports: :empty row collapse, no inline equivalent (see above)
import styled from "styled-components";
import { magnitudeOf } from "../shared/magnitude";

const topics = defineTopicManifest({
  channels: ["system.vessels", "system.bodies", "commandCentre.roster"],
});

type FleetRosterConfig = Record<string, never>;

// `system.vessels` is deliberately unfiltered (other consumers want asteroids and debris as targets), so this widget filters to craft client-side.

/** Real, flyable craft. Debris, space objects, EVA kerbals, flags and deployed hardware are not fleet vessels. */
const CRAFT_VESSEL_TYPES: ReadonlySet<VesselType> = new Set([
  VesselType.Ship,
  VesselType.Station,
  VesselType.Lander,
  VesselType.Probe,
  VesselType.Rover,
  VesselType.Base,
  VesselType.Relay,
]);

/** `Unknown` means the producer could not classify the vessel this tick, not that it is not a craft, so it stays on the roster. */
function isRosterCraft(vesselType: VesselType): boolean {
  return (
    vesselType === VesselType.Unknown || CRAFT_VESSEL_TYPES.has(vesselType)
  );
}

/** `"unknown"` is a null `commsControlSource` from the producer and must never be presented the same as a confirmed `"none"`. */
type CommsLink = "connected" | "relay" | "none" | "unknown";

interface FleetVessel {
  /** Stable vessel id, the row key and the line-updates slot correlation key. */
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
    case RosterCommsControlSource.Unknown:
    case null:
    case undefined:
      return "unknown";
    default:
      return unnamedControlSource(source);
  }
}

/** `source` is `never` here, so a new contract member is a type error; an ordinal from a newer mod still reads as unknown at runtime. */
function unnamedControlSource(_source: never): CommsLink {
  return "unknown";
}

/** A link that carries commands, which is what coverage counts; shared by the badge rollup and the coverage reading so they cannot disagree. */
function isLinked(link: CommsLink): boolean {
  return link === "connected" || link === "relay";
}

/** `system.vessels` to the widget's row shape. `known` separates "never delivered" from "delivered an empty fleet". */
function useFleet(): {
  known: boolean;
  vessels: FleetVessel[];
  coverage: Reading<Value<"ratio">>;
} {
  // A stale roster counts as known (vessels do not vanish with a missing frame), and a tombstone is a confirmed empty fleet, not a wait that never ends.
  const systemReading = topics.useTelemetry("system.vessels");
  const system = stillTrue(systemReading, EMPTY_FLEET);
  // The body catalogue is a fact, and a tombstone for it would mean a save with no celestial bodies, which cannot happen; `undefined` is the honest answer there.
  const bodiesReading = topics.useTelemetry("system.bodies");
  const bodies = stillTrue(bodiesReading, undefined);

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
          crewCount: magnitudeOf(v.crewCount),
          crewCapacity: magnitudeOf(v.crewCapacity),
          comms: rosterCommsLink(v.commsControlSource),
        })),
    [system, nameByIndex],
  );

  /** Comms coverage as a reading derived from `system.vessels` alone, so it is exactly as current as the roster. */
  const coverage = useMemo(
    () =>
      combineReadings([systemReading.vessels], (entries) => {
        const roster = (entries ?? []).filter((v) =>
          isRosterCraft(v.vesselType),
        );
        const linked = roster.filter((v) =>
          isLinked(rosterCommsLink(v.commsControlSource)),
        ).length;
        return value("ratio", roster.length > 0 ? linked / roster.length : 0);
      }),
    [systemReading],
  );

  return { known: system !== undefined, vessels, coverage };
}

type Tone = "go" | "info" | "warn" | "nogo" | "neutral";

// Used as a foreground colour (dot, tag border and text), so "info" reads the `-fg` token: the info `-bg` token is near-black and invisible here.
const TONE_HEX: Record<Tone, string> = {
  go: "var(--color-status-go-bg)",
  info: "var(--color-status-info-fg)",
  warn: "var(--color-status-warning-bg)",
  nogo: "var(--color-status-nogo-bg)",
  neutral: "var(--color-text-muted)",
};

/** Comms tier to tone, the only per-row signal the roster has a real read for. */
const COMMS_TONE: Record<CommsLink, Tone> = {
  connected: "go",
  relay: "info",
  none: "nogo",
  unknown: "neutral",
};

/** Compact comms label and a full accessible name. */
const COMMS: Record<CommsLink, { label: string; aria: string }> = {
  connected: { label: "DIRECT", aria: "Direct link" },
  relay: { label: "RELAY", aria: "Relay link" },
  none: { label: "NONE", aria: "No link" },
  unknown: { label: NULL_DISPLAY, aria: "Link state unknown" },
};

function crewLabel(v: FleetVessel): string {
  if (v.crewCount == null) return NULL_DISPLAY;
  if (v.crewCount === 0 && v.crewCapacity == null) return "0";
  return v.crewCapacity != null
    ? `${v.crewCount}/${v.crewCapacity}`
    : String(v.crewCount);
}

/** Fleet-wide comms rollup for the header badge and footer meter, worded around LINK: the widget has no data for a health verdict. */
function commsRollup(vessels: FleetVessel[]): {
  linked: number;
  none: number;
  unknown: number;
  badgeLabel: string;
  tone: Tone;
} {
  const linked = vessels.filter((v) => isLinked(v.comms)).length;
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

const ROW_HEIGHT = 25;
const GRID_FULL = "minmax(0, 1fr) auto 48px 66px";
const GRID_COMPACT = "minmax(0, 1fr) 48px 66px";

/** Decorative colour-coded link marker; its `aria-label` carries the meaning. */
function LinkDot({ tone, ariaLabel }: { tone: Tone; ariaLabel: string }) {
  return (
    <span
      role="img"
      aria-label={ariaLabel}
      style={{
        flex: "0 0 auto",
        width: 8,
        height: 8,
        borderRadius: "var(--radius-circle)",
        background: TONE_HEX[tone],
      }}
    />
  );
}

/** Outline chip: border and text both read the tone colour, unlike the filled `Badge` pill. */
function CommsTag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        fontSize: "var(--font-size-caption)",
        letterSpacing: "0.05em",
        fontWeight: 600,
        padding: "var(--inset-chip)",
        borderRadius: "var(--radius-regular)",
        border: `1px solid ${TONE_HEX[tone]}`,
        color: TONE_HEX[tone],
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/**
 * A vessel's contact state: due back, late, or given up on.
 * `overdue` is not an early `lost`: the craft is late, not gone. A silent craft with no prediction reads "no contact" and is never overdue.
 * Only going overdue (polite) and a declared loss (assertive) are announced; the per-tick countdown states are not.
 */
function FleetContactCell({
  guid,
  vesselName,
}: {
  guid: string;
  vesselName: string;
}) {
  const silence = useFleetVesselSilence(guid);
  const nowUt = useViewUt();
  const phase = contactPhase(silence, nowUt?.magnitude ?? 0);

  if (!silence || nowUt == null || phase === "nominal" || phase === undefined) {
    return null;
  }

  if (phase === "lost") {
    return (
      <Badge severity="critical" role="alert" aria-live="assertive">
        <span style={{ textDecoration: "line-through" }}>{vesselName}</span>{" "}
        lost
      </Badge>
    );
  }

  if (phase === "overdue") {
    const late = overdueSeconds(silence, nowUt.magnitude);
    return (
      <Badge severity="warning" live>
        {/* Game-time seconds (both terms are UT), so "s" rather than "irl:s". */}
        overdue by <Unit value={late == null ? null : value("s", late)} />
      </Badge>
    );
  }

  if (phase === "expected") {
    // No predicted instant means no interval to count down, not an interval of zero length that happens to render the same.
    const due =
      silence.predictedReacquisitionUt == null
        ? 0
        : value("ut", silence.predictedReacquisitionUt).minus(nowUt).magnitude;
    return (
      <Badge severity="info">
        reacquire in ~<Unit value={value("s", Math.max(0, due))} />
      </Badge>
    );
  }

  // waiting: silent, with no prediction to count down to.
  return <Badge severity="offline">no contact</Badge>;
}

/**
 * The per-row Link cell: the connectivity glyph triggers a Disclosure with this vessel's reachability and signal delay.
 * Reachability comes only off freeze-exempt `.contact`: the last `.delay` payload before a blackout still says `connected: true`, so its `connected` is never read.
 */
function FleetSignalCell({
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
  const contactHeld = contactReading.state === "stale";
  const linkState =
    reachable == null
      ? "unknown"
      : `${reachable ? "connected" : "no path"}${contactHeld ? " (last known)" : ""}`;
  // A light-time from before the link dropped, or one that stopped arriving, is still worth showing but is not a present reading.
  const heldOver =
    reachable === false || contactHeld || linkReading.state === "stale";
  // The row draws only once `oneWay` is known, so the zero fallback is never on screen.
  const oneWayReading = readingOf(linkReading, (l) =>
    value("s", l.oneWaySeconds ?? 0),
  );
  const roundTripReading = readingOf(linkReading, (l) =>
    value("s", 2 * (l.oneWaySeconds ?? 0)),
  );
  return (
    <Disclosure
      ariaLabel={`${vesselName} signal`}
      label={<CommsTag tone={tone}>{label}</CommsTag>}
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
          <dt
            style={{
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-caption)",
              letterSpacing: "0.05em",
            }}
          >
            Link
          </dt>
          <dd style={{ margin: 0, color: "var(--color-text-primary)" }}>
            {linkState}
          </dd>
        </div>
        {oneWay != null && (
          <div>
            <dt
              style={{
                color: "var(--color-text-muted)",
                fontSize: "var(--font-size-caption)",
                letterSpacing: "0.05em",
              }}
            >
              {heldOver ? "Delay (last known)" : "Delay"}
            </dt>
            <dd style={{ margin: 0, color: "var(--color-text-primary)" }}>
              one-way ~<Unit value={oneWayReading} decimals={1} /> · round-trip
              ~
              <Unit value={roundTripReading} decimals={1} />
            </dd>
          </div>
        )}
      </dl>
    </Disclosure>
  );
}

/** Wraps the per-vessel `fleet-roster.updates` slot; `:empty` collapses it live when a bound augment renders nothing for this row, which a render-time check cannot see. */
const UpdatesRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  /* The 21px left inset is computed, not chosen: NameCell's 6px padding-left +
     LinkDot's 8px width + NameCell's 7px gap, so this block hangs under the
     vessel name rather than under its status dot. It stays literal; the other
     three sides are ordinary rhythm and do tokenise. */
  padding: 0 var(--gutter-roster-cell) var(--gutter-roster-cell) 21px;

  /* Nothing contributed to this row: an augment that returns null adds no DOM,
     so the wrapper is genuinely empty and takes no space at all. */
  &:empty {
    display: none;
  }
`;

/** A confirmed-no-other-vessels tombstone: a fleet, and it is empty. */
const EMPTY_FLEET = { vessels: [] as never[] };

function FleetRosterComponent({
  w,
}: Readonly<ComponentProps<FleetRosterConfig>>) {
  const { known, vessels, coverage } = useFleet();
  const rollup = commsRollup(vessels);
  // Whose light-time the delays are computed from: the selected command centre, else the one the frames name.
  const chosenVantage = useSelectedVantage();
  const observedVantage = useObservedVantage();
  const vantage = chosenVantage ?? observedVantage;
  // Centres do not move, so a stale list is still the list.
  const centresReading = topics.useTelemetry("commandCentre.roster");
  const centres =
    centresReading.state === "observed" || centresReading.state === "stale"
      ? centresReading.value
      : undefined;
  const vantageName =
    centres?.find((c) => c.id === vantage)?.displayName ?? vantage ?? "unknown";
  const cols = w ?? 8;
  // Narrow widths shed the Body column; height never gates columns, the list scrolls.
  const compact = cols < 6;
  const gridCols = compact ? GRID_COMPACT : GRID_FULL;

  // Non-reactive read, augments register at module load, before first render.
  const updatesAugmentPresent =
    getAugmentsForSlot("fleet-roster.updates").length > 0;

  const total = vessels.length;

  return (
    <Panel
      panelTitle="Fleet"
      panelAside={
        <Badge severity={severityFromBadgeEntryTone(rollup.tone)}>
          {rollup.badgeLabel}
        </Badge>
      }
      panelFooter={
        <Meter
          label="Comms coverage"
          value={coverage}
          tone={rollup.tone}
          valueLabel={`${rollup.linked} linked · ${rollup.none} no link${
            rollup.unknown > 0 ? ` · ${rollup.unknown} unknown` : ""
          }`}
        />
      }
      sections={[
        <Section key="vantage" full>
          <ReadoutCaption>viewing from: {vantageName}</ReadoutCaption>
        </Section>,
        /* No ScrollArea: Panel's body is the scroller. */
        <Section key="roster" full>
          {total === 0 ? (
            <EmptyState>
              {known ? "No vessels tracked." : "Fleet data not available yet."}
            </EmptyState>
          ) : (
            <>
              <Grid
                cols={gridCols}
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

              {vessels.map((v) => {
                const comms = COMMS[v.comms];
                // Not gated on `compact`: the augment sheds detail at narrow widths itself, so a critical alarm never vanishes.
                const showUpdates = updatesAugmentPresent;
                return (
                  <Fragment key={v.id}>
                    <Grid
                      cols={gridCols}
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
                        <LinkDot
                          tone={COMMS_TONE[v.comms]}
                          ariaLabel={comms.aria}
                        />
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
                  </Fragment>
                );
              })}
            </>
          )}
        </Section>,
      ]}
    />
  );
}

/** Column header label; truncates like a body cell since the Vessel track shrinks below "VESSEL" at minSize. */
function ColLabel({
  right,
  children,
}: {
  right?: boolean;
  children: ReactNode;
}) {
  return (
    <Truncate
      style={{
        fontSize: "var(--font-size-caption)",
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontWeight: 600,
        padding: "var(--inset-roster-cell)",
        textAlign: right ? "right" : "left",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Truncate>
  );
}

registerComponent<FleetRosterConfig>({
  id: "fleet-roster",
  name: "Fleet Roster",
  description:
    "Fleet-wide roster table: one row per known craft (debris, asteroids, comets, flags, EVA kerbals and deployed science hardware are left out) with name, body, crew and comms link tier (direct, relay, no link), plus a fleet-wide comms-coverage summary. Each row carries a fleet-roster.updates slot for per-vessel health or alarm lines, which Fleet Reliability fills on the active vessel's row.",
  tags: ["telemetry"],
  /* Declared, not merely rendered: the picker and search tags find extending Uplinks by walking this list. */
  augmentSlots: ["fleet-roster.updates"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 4, h: 4 },
  component: FleetRosterComponent,
  channels: topics.channels,
  /* Mission control only by declaration: nothing read is ground-only, so derivation alone would put it on a pilot's screen. */
  seats: ["mission-control"],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
});

export type { CommsLink, FleetVessel };
export { FleetRosterComponent };
