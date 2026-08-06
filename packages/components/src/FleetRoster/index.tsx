import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getAugmentsForSlot,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  useFleetVesselLink,
  useSelectedVantage,
} from "@ksp-gonogo/sitrep-client";
import {
  RosterCommsControlSource,
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
  ScrollArea,
  Stack,
  severityFromBadgeTone,
  Truncate,
  Unit,
  Value,
} from "@ksp-gonogo/ui-kit";
import {
  Fragment,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { magnitudeOf } from "../shared/magnitude";

type FleetRosterConfig = Record<string, never>;

// ---------------------------------------------------------------------------
// Data read
//
// The whole roster rides the single `system.vessels` Topic (every known
// vessel, loaded or not, KspHost.BuildVesselRosterEntry's capture-add), NOT
// a legacy `fleet.vessels` DataSource key. `system.bodies` resolves each
// entry's `bodyIndex` to a display name, the same pattern SystemView already
// uses for its own vessel-body lookups. Copy of TargetPicker/DistanceToTarget/
// OrbitView/LandingStatus's own local `useStreamStatusOptional`, there is no
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

/**
 * `"unknown"` is a REAL, honestly-reported tier, not a client-side fallback,
 * the producer itself emits a null `commsControlSource` whenever CommNet had
 * nothing to read for that vessel this tick (see `VesselRosterEntry`'s own
 * doc comment), and this is that null carried through to the row. It must
 * never be presented the same as `"none"` (a confirmed no-link vessel is a
 * real ops fact; an unread vessel is not).
 */
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
    default:
      return "unknown";
  }
}

/**
 * `system.vessels` -> the widget's row shape. `known` distinguishes "the
 * topic has never delivered a sample" from "it delivered one, and the fleet
 * is genuinely empty", the same distinction the FleetRoster stub fix
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
          crewCount: magnitudeOf(v.crewCount),
          crewCapacity: magnitudeOf(v.crewCapacity),
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
 *  read for, there is no vessel-health/reliability tone here (see the
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
  unknown: { label: NULL_DISPLAY, aria: "Link state unknown" },
};

function crewLabel(v: FleetVessel): string {
  if (v.crewCount == null) return NULL_DISPLAY;
  if (v.crewCount === 0 && v.crewCapacity == null) return "0";
  return v.crewCapacity != null
    ? `${v.crewCount}/${v.crewCapacity}`
    : String(v.crewCount);
}

/**
 * Fleet-wide comms rollup, the header badge + footer meter both read off
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
// Row chrome
//
// The grid and its centring come from the kit (`Grid`); the fixed row height
// is the roster's own, because the list virtualises against it. `cols` is
// passed per instance rather than baked in, since it depends on the compact
// breakpoint.
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 25;
const GRID_FULL = "minmax(0, 1fr) auto 48px 66px";
const GRID_COMPACT = "minmax(0, 1fr) 48px 66px";

/** Small colour-coded circular link marker, purely decorative (the row's
 * `aria-label` on this element carries the meaning). No shared "dot"
 * primitive fits standalone (StatusIndicator's dot is only reachable
 * bundled with its own text), so this stays a plain styled span. */
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

/**
 * Compact outline chip: border AND text both read the tone colour, no
 * background fill (see the `TONE_HEX` doc comment above for why). This is
 * deliberately NOT `<Badge>`, which is always a filled pill - a different
 * look this widget's comms tag was never meant to have.
 */
function CommsTag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        fontSize: "var(--font-size-2xs)",
        letterSpacing: "0.05em",
        fontWeight: 600,
        padding: "var(--space-hair) var(--space-6)",
        borderRadius: "var(--radius-sm)",
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
 * The per-row Link cell: the connectivity glyph is the trigger of an accessible
 * Disclosure whose panel shows this vessel's own signal delay + reachability,
 * read from `fleet.<guid>.delay` (Plan 2 / 2c). Focus/tap reachable, NOT
 * hover-only. Each row subscribing to its own `fleet.<guid>.delay` IS the
 * dynamic-subscription reconcile: rows mount/unmount as `system.vessels` changes
 * and each `useFleetVesselLink` ref-counts its own topic.
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
  const link = useFleetVesselLink(guid);
  const oneWay = link?.oneWaySeconds ?? null;
  const linkState =
    link == null ? "unknown" : link.connected ? "connected" : "no path";
  return (
    <Disclosure
      ariaLabel={`${vesselName} signal`}
      label={<CommsTag tone={tone}>{label}</CommsTag>}
    >
      <dl
        style={{
          margin: 0,
          display: "grid",
          gap: "var(--space-2)",
          fontSize: "var(--font-size-xs)",
          whiteSpace: "nowrap",
        }}
      >
        <div>
          <dt
            style={{
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-2xs)",
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
                fontSize: "var(--font-size-2xs)",
                letterSpacing: "0.05em",
              }}
            >
              Delay
            </dt>
            <dd style={{ margin: 0, color: "var(--color-text-primary)" }}>
              one-way ~<Unit value={value("s", oneWay)} decimals={1} /> ·
              round-trip ~
              <Unit value={value("s", 2 * oneWay)} decimals={1} />
            </dd>
          </div>
        )}
      </dl>
    </Disclosure>
  );
}

/**
 * Wraps the per-vessel `fleet-roster.updates` slot. A bound augment may
 * legitimately render nothing for THIS row (e.g. the reliability augment's
 * active-vessel-only gate): collapse the block's own padding/gap in that
 * case, so it doesn't leave an empty gap under every other row. Mirrors the
 * `&:empty` CSS rule this replaces: `:empty` doesn't survive outside a
 * stylesheet rule, so the same check runs against the committed DOM here
 * instead, via a ref + layout effect.
 */
function UpdatesRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasContent, setHasContent] = useState(true);
  useLayoutEffect(() => {
    setHasContent((ref.current?.childNodes.length ?? 0) > 0);
  });
  return (
    <div
      ref={ref}
      style={
        hasContent
          ? {
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              // The 21px left inset is computed, not chosen: NameCell's 6px
              // padding-left + LinkDot's 8px width + NameCell's 7px gap, so
              // this block hangs under the vessel name rather than under its
              // status dot. It stays literal; the other three sides are
              // ordinary rhythm and do tokenise.
              padding: "0 var(--space-6) var(--space-6) 21px",
            }
          : { display: "none" }
      }
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

function FleetRosterComponent({
  w,
}: Readonly<ComponentProps<FleetRosterConfig>>) {
  const { known, vessels } = useFleet();
  const rollup = commsRollup(vessels);
  // Whose light-time the per-vessel delays are computed from: the selected
  // command centre (Plan 3). Resolved to its display name via the roster,
  // falling back to the raw id (e.g. the default "ksc" before the roster lands).
  const vantage = useSelectedVantage();
  const centres = useTelemetry("commandCentre.roster");
  const vantageName =
    centres?.find((c) => c.id === vantage)?.displayName ?? vantage;
  const cols = w ?? 8;
  // Below the width threshold the Body column and the per-vessel update lines
  // are shed, the identity + crew + link (the at-a-glance fleet state) always
  // stay. Height doesn't gate columns; the list just scrolls.
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
        <Badge severity={severityFromBadgeTone(rollup.tone)}>
          {rollup.badgeLabel}
        </Badge>
      }
    >
      {/* Vantage caption relocated out of the panel subtitle into the body
          (staging change); severity= on the aside Badge is staging's canonical
          tone wiring. */}
      <ReadoutCaption>viewing from: {vantageName}</ReadoutCaption>
      {total === 0 ? (
        <EmptyState>
          {known ? "No vessels tracked." : "Fleet data not available yet."}
        </EmptyState>
      ) : (
        <ScrollArea style={{ marginTop: "var(--space-6)" }}>
          <Grid
            cols={gridCols}
            gap="sm"
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
            // The per-vessel line-updates block is PURELY the
            // `fleet-roster.updates` augment slot now, the seam for a
            // future Reliability/TestFlight uplink to compose real
            // alarm/health one-liners here. It carries no data of its own
            // (there is no reliability signal behind this widget; see the
            // module doc comment), so it renders nothing until an uplink
            // actually registers.
            const showUpdates = !compact && updatesAugmentPresent;
            return (
              <Fragment key={v.id}>
                <Grid cols={gridCols} gap="sm" style={{ height: ROW_HEIGHT }}>
                  <Cluster
                    justify="start"
                    align="center"
                    title={v.name}
                    style={{ gap: "7px", padding: "0 var(--space-6)" }}
                  >
                    <LinkDot
                      tone={COMMS_TONE[v.comms]}
                      ariaLabel={comms.aria}
                    />
                    <Truncate
                      style={{
                        fontSize: "var(--font-size-sm)",
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {v.name}
                    </Truncate>
                  </Cluster>
                  {!compact && (
                    <Truncate
                      title={v.body ?? undefined}
                      style={{
                        fontSize: "var(--font-size-sm)",
                        color: "var(--color-text-muted)",
                        padding: "0 var(--space-6)",
                      }}
                    >
                      {v.body ?? NULL_DISPLAY}
                    </Truncate>
                  )}
                  <Value
                    tone="default"
                    size="sm"
                    style={{
                      textAlign: "right",
                      padding: "0 var(--space-6)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {crewLabel(v)}
                  </Value>
                  <div
                    style={{ padding: "0 var(--space-6)", textAlign: "right" }}
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
                      }}
                    />
                  </UpdatesRow>
                )}
              </Fragment>
            );
          })}
        </ScrollArea>
      )}

      <Stack
        gap="sm"
        style={{
          gap: "var(--space-6)",
          marginTop: "auto",
          paddingTop: "var(--space-6)",
          flexShrink: 0,
        }}
      >
        <Meter
          label="Comms coverage"
          value={total > 0 ? rollup.linked / total : 0}
          tone={rollup.tone}
          valueLabel={`${rollup.linked} linked · ${rollup.none} no link${
            rollup.unknown > 0 ? ` · ${rollup.unknown} unknown` : ""
          }`}
          size={compact ? "sm" : "md"}
        />
      </Stack>
    </Panel>
  );
}

/**
 * Column header label. The Vessel column's grid track is minmax(0, 1fr): at
 * the tiny-4x4 minSize it shrinks well below "VESSEL"'s natural width, so
 * this truncates like a body cell rather than spilling into "CREW".
 */
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
        fontSize: "var(--font-size-xs)",
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontWeight: 600,
        padding: "0 var(--space-6)",
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
    "Fleet-wide roster table: one row per known CRAFT (debris, asteroids/comets, flags, EVA kerbals, and deployed science hardware are filtered out, see isRosterCraft) with name, body, crew, and comms link tier (direct/relay/no link), plus a fleet-wide comms-coverage summary. There is no per-vessel reliability/health signal behind this widget (reliability.summary is active-vessel-only) - the fleet-roster.updates augment slot is the seam for a future Reliability/TestFlight uplink to add that. SystemView draws only the ACTIVE vessel spatially (system.vessels carries no per-vessel position, so a whole-fleet spatial view is a Phase 2 gap, not something this table's data could feed even if SystemView grew a slot for it).",
  tags: ["telemetry", "kerbalism"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 4, h: 4 },
  component: FleetRosterComponent,
  dataRequirements: ["system.vessels", "system.bodies", "commandCentre.roster"],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
});

export type { CommsLink, FleetVessel };
export { FleetRosterComponent };
