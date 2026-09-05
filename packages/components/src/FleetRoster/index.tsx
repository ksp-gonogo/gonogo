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
  type Reading,
  useFleetVesselContact,
  useFleetVesselLink,
  useFleetVesselSilence,
  useSelectedVantage,
  useViewUt,
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
  Section,
  severityFromBadgeEntryTone,
  Text,
  Truncate,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { Fragment, type ReactNode, useMemo } from "react";
/*
 * UpdatesRow below keeps styled-components for a load-bearing `&:empty` rule:
 * an inline style cannot express a pseudo-class, and the JS equivalent it
 * replaces could only answer the question once (see that component's doc).
 */
// biome-ignore lint/style/noRestrictedImports: :empty row collapse, no inline equivalent (see above)
import styled from "styled-components";
import { magnitudeOf } from "../shared/magnitude";

const topics = defineTopicManifest({
  channels: ["system.vessels", "system.bodies", "commandCentre.roster"],
});

type FleetRosterConfig = Record<string, never>;

// ---------------------------------------------------------------------------
// Data read
//
// The whole roster rides the single `system.vessels` Topic (every known
// vessel, loaded or not, KspHost.BuildVesselRosterEntry's capture-add), NOT
// a legacy `fleet.vessels` DataSource key. `system.bodies` resolves each
// entry's `bodyIndex` to a display name, the same pattern SystemView already
// uses for its own vessel-body lookups. Copy of TargetPicker/Targeting/
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
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

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
  // FAIL-OPEN FIX, not merely a migration. `known` was `system !== undefined`,
  // and a `Reading` is never undefined, so the roster would have reported itself
  // KNOWN before a single frame arrived: an empty fleet presented as a confirmed
  // empty fleet, on a GO/NO-GO-adjacent surface. `known` now means what its name
  // says, that the fleet list has actually reported.
  //
  // A stale roster counts as known: a vessel does not cease to exist because a
  // frame went missing, and the per-vessel comms state inside it is rendered from
  // its own field rather than inferred from this list's currency.
  /**
   * A tombstone here is a CONFIRMED empty fleet, and the pre-migration gate said so
   * (`system !== undefined` was false only for never-arrived). Collapsing it into
   * `pending` would show "waiting for the fleet" to an operator whose save genuinely
   * has no other vessels, which is a wait that never ends.
   */
  const systemReading = topics.useTelemetry("system.vessels");
  const system = stillTrue(systemReading, EMPTY_FLEET);
  // The body catalogue is a fact, and a tombstone for it would mean a save with no
  // celestial bodies, which cannot happen; `undefined` is the honest answer there.
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
 * A vessel's contact state: due back, late, or given up on.
 *
 * The state worth the widget is `overdue`, past the moment geometry said the
 * craft should have re-appeared, but before the deadline that declares it lost.
 * That is the "expected back, didn't show" moment, and it is deliberately not
 * an early form of `lost`: there is still time for the craft to appear, and the
 * operator is told it is late rather than gone.
 *
 * A silent craft with no prediction renders as "no contact" with no countdown,
 * never as overdue. Nothing promised it would be back, so nothing can be late,
 * see `contactPhase`, which is where that distinction lives so no renderer has
 * to re-derive it.
 *
 * Announcements are scoped to what each state warrants: `role="status"`
 * (polite) for going overdue, `role="alert"` (assertive) for a declared loss,
 * and nothing at all for the states that change every tick, which would
 * otherwise flood a screen reader with a running countdown.
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
        {/* Game-time seconds (both terms are UT), so "s" rather than "irl:s".
            `late` cannot actually be null in this branch - `contactPhase`
            only says "overdue" when a predicted reacquisition exists - and
            Unit answers an absent value with the null token anyway, so the
            unreachable arm no longer needs a hand-written placeholder. */}
        overdue by <Unit value={late == null ? null : value("s", late)} />
      </Badge>
    );
  }

  if (phase === "expected") {
    // No predicted instant means no interval to count down, not an interval of
    // zero length that happens to render the same.
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
 * The per-row Link cell: the connectivity glyph is the trigger of an accessible
 * Disclosure whose panel shows this vessel's own reachability and signal delay.
 * Focus/tap reachable, NOT hover-only. Each row subscribing to its own
 * `fleet.<guid>.*` topics IS the dynamic-subscription reconcile: rows
 * mount/unmount as `system.vessels` changes and each hook ref-counts its own
 * topic.
 *
 * Reachability comes off `fleet.<guid>.contact` and the light-time off
 * `fleet.<guid>.delay`, and the split is load-bearing rather than tidy.
 * `.delay` is Delayed and deliberately not freeze-exempt, and the mod arms the
 * per-subject freeze one statement before that tick's `.delay` publish, so the
 * LAST payload a client ever receives for a vessel entering blackout carries
 * `connected: true` and a last-known one-way. Reading that field put "Link:
 * connected" and a live-looking round-trip in the body of a row whose own chip
 * read NONE off live `system.vessels`, a contradiction inside one row that an
 * operator reported. `.contact` is freeze-exempt precisely so the disconnect
 * edge can escape, so it is the only field here that can answer whether the
 * link is up, and `.delay`'s own `connected` is never read.
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
  const contact = useFleetVesselContact(guid);
  const link = useFleetVesselLink(guid);
  const oneWay = link?.oneWaySeconds ?? null;
  // ONE reading of the one field, so the Link term and the Delay label cannot
  // disagree about it. Read separately, an arrived record whose `connected` was
  // absent said "no path" in one place and labelled its light-time current in
  // the other.
  const reachable = contact == null ? null : contact.connected === true;
  const linkState =
    reachable == null ? "unknown" : reachable ? "connected" : "no path";
  // A light-time measured before the link went down. Still worth showing (it is
  // what a reacquisition is planned against) but it is not a present reading,
  // and the freeze means it cannot become one until the vessel is back.
  const heldOver = reachable === false;
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
              {heldOver ? "Delay (last known)" : "Delay"}
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
 * active-vessel-only gate): collapse the block's own padding/gap in that case,
 * so it doesn't leave an empty gap under every other row.
 *
 * The emptiness has to be asked of the DOM, because whether an augment rendered
 * anything is not something this widget can know, and `:empty` is the only form
 * of the question that stays live. The ref + layout effect this replaces asked
 * it once: a layout effect runs when its OWN component renders, and an augment
 * filling in from a telemetry frame re-renders the child alone, so a slot that
 * arrived after mount stayed hidden forever. That is the normal case for
 * anything riding the stream, and it hid the reliability augment in every
 * render of it.
 */
const UpdatesRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  /* The 21px left inset is computed, not chosen: NameCell's 6px padding-left +
     LinkDot's 8px width + NameCell's 7px gap, so this block hangs under the
     vessel name rather than under its status dot. It stays literal; the other
     three sides are ordinary rhythm and do tokenise. */
  padding: 0 var(--space-6) var(--space-6) 21px;

  /* Nothing contributed to this row: an augment that returns null adds no DOM,
     so the wrapper is genuinely empty and takes no space at all. */
  &:empty {
    display: none;
  }
`;

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

/** A confirmed-no-other-vessels tombstone: a fleet, and it is empty. */
const EMPTY_FLEET = { vessels: [] as never[] };

function FleetRosterComponent({
  w,
}: Readonly<ComponentProps<FleetRosterConfig>>) {
  const { known, vessels } = useFleet();
  const rollup = commsRollup(vessels);
  // Whose light-time the per-vessel delays are computed from: the selected
  // command centre (Plan 3). Resolved to its display name via the roster,
  // falling back to the raw id (e.g. the default "ksc" before the roster lands).
  const vantage = useSelectedVantage();
  // A command-centre roster is ground-side and declared unmodellable: centres do
  // not move and a stale list is still the list. Falls back to the raw id before
  // anything has landed, which is what the comment above already described.
  const centresReading = topics.useTelemetry("commandCentre.roster");
  const centres =
    centresReading.state === "observed" || centresReading.state === "stale"
      ? centresReading.value
      : undefined;
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
        <Badge severity={severityFromBadgeEntryTone(rollup.tone)}>
          {rollup.badgeLabel}
        </Badge>
      }
      /* PINNED by Panel rather than merely rendered last. The coverage rollup
         used to sit after a `flex: 1` ScrollArea with `margin-top: auto`, and
         both of those only work on a direct child of the body. */
      panelFooter={
        <Meter
          label="Comms coverage"
          value={total > 0 ? rollup.linked / total : 0}
          tone={rollup.tone}
          valueLabel={`${rollup.linked} linked · ${rollup.none} no link${
            rollup.unknown > 0 ? ` · ${rollup.unknown} unknown` : ""
          }`}
          size={compact ? "sm" : "md"}
        />
      }
      sections={[
        /* Vantage caption relocated out of the panel subtitle into the body
           (staging change); severity= on the aside Badge is staging's canonical
           tone wiring. */
        <Section key="vantage" full>
          <ReadoutCaption>viewing from: {vantageName}</ReadoutCaption>
        </Section>,
        /* No `ScrollArea`. Panel's body IS the scroller and owns the glow, so a
           second one here drew its glow inside the outer body's inset. */
        <Section key="roster" full>
          {total === 0 ? (
            <EmptyState>
              {known ? "No vessels tracked." : "Fleet data not available yet."}
            </EmptyState>
          ) : (
            <>
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
                // `fleet-roster.updates` augment slot, where the reliability
                // augment composes its alarm/health one-liners. It carries no
                // data of its own, so it renders nothing until an uplink
                // actually registers.
                //
                // Deliberately NOT gated on `compact`. It used to be, which meant
                // every reliability state including a critical part failure
                // vanished below six columns, the normal width of a portrait
                // station panel. The augment sheds its detail rows at that width
                // instead (it is handed `compact`), so density is traded for
                // words rather than for the alarm.
                const showUpdates = updatesAugmentPresent;
                return (
                  <Fragment key={v.id}>
                    <Grid
                      cols={gridCols}
                      gap="sm"
                      style={{ height: ROW_HEIGHT }}
                    >
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
                        <FleetContactCell guid={v.id} vesselName={v.name} />
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
                      <Text
                        tone="default"
                        size="sm"
                        style={{
                          textAlign: "right",
                          padding: "0 var(--space-6)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {crewLabel(v)}
                      </Text>
                      <div
                        style={{
                          padding: "0 var(--space-6)",
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
    "Fleet-wide roster table: one row per known CRAFT (debris, asteroids/comets, flags, EVA kerbals, and deployed science hardware are filtered out, see isRosterCraft) with name, body, crew, and comms link tier (direct/relay/no link), plus a fleet-wide comms-coverage summary. Each row carries a fleet-roster.updates augment slot, which is where an Uplink puts per-vessel health or alarm lines; it renders nothing until one binds, and no Uplink binds it today. When one does it can only ever fill ONE row: reliability.* is active-vessel-only (it carries no vesselId), so every other craft's row shows nothing whatever its condition. SystemView draws only the ACTIVE vessel spatially: system.vessels carries no per-vessel position, so a whole-fleet spatial view is not something this table's data could feed even if SystemView grew a slot for it.",
  tags: ["telemetry"],
  /*
   * DECLARED, not merely rendered. `effectiveSearchTags` and `uplinkAdditions`
   * both walk this list to find the Uplinks binding into the widget, so a slot
   * that is rendered without being declared credits nobody: the picker showed
   * no extending Uplink, and the search tag was supplied by hand as a literal
   * mod name instead. That named one of the two Uplinks that provide
   * reliability, stayed put when neither was installed, and put a mod's name in
   * a core widget. Declaring the slot lets the real mechanism answer.
   */
  augmentSlots: ["fleet-roster.updates"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 4, h: 4 },
  component: FleetRosterComponent,
  channels: topics.channels,
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
});

export type { CommsLink, FleetVessel };
export { FleetRosterComponent };
