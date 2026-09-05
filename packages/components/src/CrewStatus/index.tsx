import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  getAugmentsForSlot,
  registerComponent,
  useContributions,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type Reading,
  useStream,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { Meter, type MeterTone } from "@ksp-gonogo/ui";
import {
  BigReadout,
  Card,
  Cluster,
  EmptyState,
  Inline,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  type ReadoutTone,
  Section,
  Stack,
  Text,
  Truncate,
  Unit,
  useElementSize,
  WidgetMeters,
} from "@ksp-gonogo/ui-kit";
import { type ReactNode, useMemo } from "react";
import { magnitudeOf, type Quantityish } from "../shared/magnitude";
// Side-effect import: the widget's own `crew-status.badges` panel-badge
// self-contribution (the info-tone "N/M aboard" header chip) registers on
// module load, see that file's own doc comment for why it lives apart from
// the per-row AugmentSlot declarations below.
import "./badge";

const topics = defineTopicManifest({
  channels: ["vessel.crew", "vessel.state"],
  optionalChannels: ["vessel.resources"],
  fields: [
    "vessel.crew.crew",
    "vessel.crew.count",
    "vessel.crew.capacity",
    "vessel.state.isEVA",
  ],
});

/**
 * Tiny-mode hero readout font size. `BigReadout`'s 38px max coexists fine
 * with its caption in a roomy panel, but at the widget's 3x3 `minSize` the
 * number + stacked "OF n ABOARD" caption overflows the short panel and the
 * caption gets clipped by `Panel`'s `overflow: hidden`. We can't touch the
 * shared `BigReadout`, so this caps the number lower via an inline style
 * override and lets the centred flex box keep both lines inside the box.
 *
 * Off the type scale on purpose: this is a fluid, viewport-responsive fit,
 * and its endpoints are not independent font-size choices. The scale stops
 * at --font-size-lg (16px) and a fixed rung here would freeze the fit.
 */
const TINY_READOUT_STYLE = {
  fontSize: "clamp(20px, 4vw, 30px)",
  minHeight: 0,
} as const;

/**
 * Leading per-crew avatar cell bounds: a square that reserves room for an
 * avatar-face augment, clamped 36-56px so it stays legible on a cramped tile
 * and never dominates a roomy one.
 *
 * The size itself tracks the widget's own measured content width (`useElementSize`
 * on the roster wrapper in `CrewStatusComponent`, `avatarCellSizePx` below),
 * not a `vw` viewport-relative clamp (the previous version's approach, and
 * `TINY_READOUT_STYLE`'s idiom, still fine THERE because that readout
 * genuinely wants to track the browser window). A dashboard tile's on-screen
 * width has no fixed relationship to the viewport, a station on a big
 * monitor with a NARROW crew tile would otherwise render a large avatar and
 * a wide tile on a small laptop a small one, backwards from what "scale with
 * the widget" means. Mirrors `Twr`/`SystemView`'s existing
 * measured-slot-width idiom (`useElementSize` + `Math.min`/`Math.max`), not
 * a CSS-only fix.
 *
 * Only reserved when an Uplink actually binds `crew-status.avatar`
 * (`avatarAugmentPresent` in `renderBody`, below): a vanilla roster with no
 * avatar-providing Uplink installed carries no leading cell at all, not a
 * same-size cell showing an empty placeholder. Operator feedback: a ~40-56px
 * box reserved for nothing but a 6px decorative dot was wasted width on
 * every row, and the dot never signalled anything (no augment, no
 * kerbal-not-seated flag, nothing) - just a bullet point standing in for a
 * future avatar image. Once an avatar-providing Uplink IS present (e.g. a
 * facecam augment), the cell renders exactly as before, including the
 * per-kerbal case where THAT Uplink has nothing to show for one kerbal (it
 * now shows blank there, not the bullet either, same "nothing to signal"
 * reasoning).
 */
const AVATAR_CELL_MIN_PX = 36;
const AVATAR_CELL_MAX_PX = 56;
/** Fraction of the measured roster width the avatar cell targets before clamping. */
const AVATAR_CELL_WIDTH_FRACTION = 0.2;
/** Seed size used until the first real `ResizeObserver` measurement lands
 *  (matches the widget's own `defaultSize.w` of 6 columns at the render
 *  harness's grid formula, so the very first paint already lands mid-range
 *  rather than pinned to the floor). */
const AVATAR_MEASURE_SEED = { w: 232, h: 0 };

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

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

/** Pure size calc, unit-testable with no DOM: clamps a fraction of the measured roster width between the cell's min and max bounds. */
function avatarCellSizePx(containerWidthPx: number): number {
  return Math.round(
    Math.min(
      AVATAR_CELL_MAX_PX,
      Math.max(
        AVATAR_CELL_MIN_PX,
        containerWidthPx * AVATAR_CELL_WIDTH_FRACTION,
      ),
    ),
  );
}

type CrewStatusConfig = Record<string, never>;

// EVA suit resources (additive; only meaningful while the active vessel IS
// an EVA kerbal). A stock KSP EVA kerbal is a real Vessel with its own
// resource-carrying Part (KSP's own `GameEvents.onCrewOnEva` hands over the
// spawned Vessel), so the already-existing, already-consumed
// `vessel.resources` Topic (see FuelStatus) works against it unchanged - no
// new wire protocol needed. Which resources ride along on the suit is decided
// by the install's own life-support profile, via each resource's `on_eva`
// transfer amount; the two an unmodified profile carries are ElectricCharge
// and Oxygen, which is why those are the two looked up. Plain resource-name
// lookups, no mod-specific shape, and an install whose profile puts neither
// on the suit simply renders nothing.

interface SuitResourceReadout {
  current: number;
  max: number;
}

/** Extracts a `{current, max}` pair off a `vessel.resources` entry, or
 *  `undefined` when the resource is absent or has no usable capacity. */
function toSuitResourceReadout(
  entry: { current?: Quantityish; max?: Quantityish } | undefined,
): SuitResourceReadout | undefined {
  if (!entry) return undefined;
  const current = magnitudeOf(entry.current);
  const max = magnitudeOf(entry.max);
  if (current === null || max === null || max <= 0) return undefined;
  return { current, max };
}

/** Tone for a resource fraction remaining: full tank is calm, empty is
 *  alarming - the inverse of a "toward fatal" accumulator reading. */
function suitResourceTone(fraction: number): MeterTone {
  if (fraction <= 0.15) return "nogo";
  if (fraction <= 0.4) return "warn";
  return "go";
}

/**
 * Compact EVA-suit resource block: O2 + EC meters shown only while the
 * active vessel is an EVA kerbal and the Uplink actually publishes
 * `vessel.resources` for it. Presentational (no hooks) - renders nothing
 * when neither resource is available, so an Uplink without this data leaves
 * the roster exactly as before.
 */
function EvaSuitReadout({
  oxygen,
  electricCharge,
  notCurrent: readingsNotCurrent,
}: Readonly<{
  oxygen: SuitResourceReadout | undefined;
  electricCharge: SuitResourceReadout | undefined;
  /** The suit figures went stale rather than never arriving. */
  notCurrent: boolean;
}>) {
  // Said out loud rather than rendered as an absent meter. A kerbal outside the
  // craft with no consumption figures is a different situation from one whose
  // suit reports nothing, and only the first means "get them back inside".
  if (readingsNotCurrent) {
    return (
      <Cluster justify="start" gap="lg" wrap aria-label="EVA suit resources">
        <Text tone="warn" size="xs">
          Suit resources no longer current
        </Text>
      </Cluster>
    );
  }
  if (!oxygen && !electricCharge) return null;
  return (
    <Cluster justify="start" gap="lg" wrap aria-label="EVA suit resources">
      {oxygen && (
        <Meter
          size="sm"
          label="O2"
          value={oxygen.current / oxygen.max}
          tone={suitResourceTone(oxygen.current / oxygen.max)}
          valueLabel={`${oxygen.current.toFixed(1)} / ${oxygen.max.toFixed(1)}`}
        />
      )}
      {electricCharge && (
        <Meter
          size="sm"
          label="EC"
          value={electricCharge.current / electricCharge.max}
          tone={suitResourceTone(electricCharge.current / electricCharge.max)}
          valueLabel={`${electricCharge.current.toFixed(0)} / ${electricCharge.max.toFixed(0)}`}
        />
      )}
    </Cluster>
  );
}

// The `crew-status.row-badges` slot contract.
//
// A per-crew-row inline badges slot: an Uplink backing a life-support or
// radiation capability can badge each kerbal with comfort/dose without leaving
// this widget. Because the slot renders once PER ROW, its props MUST carry the crew
// member's identity so the augment badges the right kerbal, `crewName` is that
// identity (the only per-kerbal handle exposed here), and
// `crewIndex` disambiguates in the (legal) case of two kerbals sharing a name.
//
// It was `crew-status.badges` and had to move. That string is also the
// framework's auto-completed `${componentId}.badges` CONTRIBUTION slot, which
// exists for every widget whether or not the widget asks for it and is fed by
// two live contributions (`./badge.ts` and a crew-survival badge contributed
// from an Uplink). One name, two registries, two places on screen, and
// nothing to tell an author which one they were binding. The framework segment
// cannot be renamed for one widget, so this one was.

/** Props passed to every `crew-status.row-badges` augment, one per crew row. */
export interface CrewBadgeContext {
  /** The crew member this badge row belongs to, its identity for the augment. */
  crewName: string;
  /** Position in the roster; disambiguates duplicate names. */
  crewIndex: number;
}

// Declaration-merge the slot id → props type into core's `SlotRegistry`.
// Co-located here (not in a shared central file) so parallel slot work in
// other widgets can't collide. Makes `registerAugment({ augments:
// "crew-status.row-badges" })` and `<AugmentSlot name="crew-status.row-badges"
// props={...} />` type-check precisely against `CrewBadgeContext`.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "crew-status.row-badges": CrewBadgeContext;
  }
}

// The `crew-status.avatar` slot contract.
//
// A per-crew-row LEADING square cell (left of the name): the SDK-independent
// shell of a per-kerbal avatar/portrait. An Uplink can register an augment
// that fills it with a live face, keyed by kerbal identity. Same per-row
// keying as `crew-status.row-badges`, `crewName` is the augment's identity
// handle and `crewIndex` disambiguates duplicate names. The cell itself is
// only reserved while at least one augment is bound to this slot at all
// (`avatarAugmentPresent`, `renderBody` below); with no avatar-providing
// Uplink installed, no cell is rendered and the row's leading space goes to
// the name instead, not a same-size empty placeholder. Once an Uplink IS
// providing avatars, the cell renders as usual, and for any one kerbal that
// Uplink has nothing to show for (avatar source disabled, kerbal not seated),
// the cell renders blank rather than a placeholder: the avatar augment is
// entirely optional, both at the slot level and per-kerbal.

/** Props passed to every `crew-status.avatar` augment, one per crew row. */
export interface CrewAvatarContext {
  /** The crew member this avatar belongs to, its identity for the augment. */
  crewName: string;
  /** Position in the roster; disambiguates duplicate names. */
  crewIndex: number;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "crew-status.avatar": CrewAvatarContext;
  }
}

// Per-crew-row survival meters
//
// There is no `crew-status.survival` slot any more, and no widget-authored
// anything: each roster row mounts ui-kit's `<WidgetMeters row={name}>`, which
// draws whatever is contributed to the framework's universal
// `crew-status.meters` segment for that kerbal.
//
// It WAS an augment slot, filled by an Uplink component whose entire render
// was a `Stack` of `Meter` and nothing else: zero pixels this widget did not
// already own. That is the definition of a contribution, and as one the host
// gets back what an augment could never give it, the ability to count what
// arrived, order it, and lay it out with its own rows. The kerbal's name rides
// on each entry's `row`, which is what lets a once-per-widget segment address a
// per-row extension at all.
//
// This widget still carries no mod-specific reads: the derivation lives in the
// contributing Uplink's own Processor exactly as it did before.

// The `crew-status.row-tone` CONTRIBUTION slot (contribution-slots-spec,
// same "pure data, host renders its own chrome" model as ShipMap's
// `ship-map.part-meters`/`.part-meta`, NOT an AugmentSlot: unlike
// `.row-badges`/`.avatar`/`.summary` above, an Uplink doesn't render anything
// into this slot, it only says how alarming a kerbal's situation is and the
// widget paints its own `Card` accordingly. That split matters here
// specifically: the per-row `Card` wraps the WHOLE row (name, badges, meters
// together), so no single augment's own JSX has a natural place to reach up
// and colour an ancestor element it doesn't render. A contribution sidesteps
// that: this widget stays exactly as mod-agnostic as the meters segment
// already is, while the contributing Uplink still gets to say which kerbal is
// critical.
//
// A contributor names a SEVERITY and never a tone or a colour, because the
// host owns the palette: `ROW_TONE_BY_SEVERITY` below is the only place that
// decides what "critical" looks like. The vocabulary is the established
// `"info" | "warning" | "critical"`, the same three words every other
// contribution in the app uses.
//
// Entries are looked up by `crewName` (`rowToneByName` in the component
// body, below); a kerbal absent from every contribution's entries renders
// with no tone (`Card`'s own default, an untinted border). First-registered
// entry per name wins, same convention as ShipMap's `groupByPart`.

/** One entry of a `crew-status.row-tone` contribution: how alarming this
 *  kerbal's situation is, or omit the kerbal entirely for "nothing to
 *  report". */
export interface CrewRowToneEntry {
  /** The crew member this entry is about; matched against the roster row by name. */
  crewName: string;
  /** How alarming the situation is. The host decides what that looks like. */
  severity: "info" | "warning" | "critical";
}

declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "crew-status.row-tone": {
      entry: CrewRowToneEntry;
      topics: "vessel.crew";
    };
  }
}

/** The host's palette decision, and the only one: a contributor's severity
 *  becomes the `Card` tone here and nowhere else. */
const ROW_TONE_BY_SEVERITY: Record<CrewRowToneEntry["severity"], ReadoutTone> =
  {
    info: "default",
    warning: "warning",
    critical: "alert",
  };

// The `crew-status.summary` slot contract.
//
// A WHOLE-WIDGET section slot, rendered once above the roster rather than
// once per kerbal: the generic home for a status that affects the whole
// crew together, not any one of them individually (e.g. a vessel-wide
// radiation-environment reading). Unlike `.badges`/`.avatar`/`.survival`
// above, this carries no per-kerbal identity, there is exactly one instance
// of it per widget, mirroring `ThermalStatus`'s `thermal-status.badges`
// slot (`ThermalStatus/index.tsx`): no props, an empty object contract.
// Renders nothing when no augment is bound, so the roster degrades
// gracefully exactly like the other slots.

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "crew-status.summary": Record<string, never>;
  }
}

/**
 * `v.crew` is documented as `string[]` ("List of crew names") in the
 * the source's own readme. (Historical note, kept for the object-shape
 * guard below: some sources augment this key with a richer per-kerbal
 * object instead of a bare name string; the defensive object-shape parsing
 * stays useful for any `v.crew`-shaped source.)
 *
 * `v.crew` lives on the wire at `vessel.crew.crew`, a `CrewMember[]`
 * (`contract.ts`'s `{name?, trait?, ...}`), read here off the canonical
 * `vessel.crew` Topic. The object-shape branch below (already required for
 * the richer per-kerbal payloads some sources publish) is exactly what parses
 * `CrewMember` entries too, no shape fix needed.
 *
 * Guard against unknown shapes (e.g. the server returning null before
 * the first sample or a mod replacing the payload), extract strings
 * and drop anything else.
 */
function toCrewNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim().length > 0) out.push(entry);
    else if (entry && typeof entry === "object" && "name" in entry) {
      const name = (entry as { name: unknown }).name;
      if (typeof name === "string" && name.trim().length > 0) out.push(name);
    }
  }
  return out;
}

function CrewStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<CrewStatusConfig>>) {
  // Roster, count, and capacity all ride the single `vessel.crew` Topic,
  // read it once and pick the three fields off it.
  /**
   * The roster is a fact, not a measurement: nobody leaves the capsule because the
   * link dropped, so a held roster is still the crew. The suit resources further
   * down are the opposite and are read off the observation alone.
   */
  const crewReading = topics.useTelemetry("vessel.crew");
  const crew = stillTrue(crewReading, undefined);
  const crewRaw = crew?.crew;
  const crewCount = crew?.count;
  const crewCapacity = crew?.capacity;
  // `v.isEVA` -> `vessel.state.isEVA`, a derived field on the `vessel.state`
  // channel (map-topic.ts), read via `useStream` like the other derived reads.
  const isEVA = useStream<VesselState>("vessel.state")?.isEVA;

  // Connectivity indicator (mirroring the WarpControl pilot): count, roster,
  // and capacity all land on the same `vessel.crew` wire channel, so
  // `v.crewCount`'s stream status is representative of the whole trio.

  // EVA suit resources - additive, only relevant while the active vessel IS
  // an EVA kerbal (see the EvaSuitReadout block comment above). Read
  // unconditionally (stable hook order); undefined whenever no Uplink
  // publishes `vessel.resources` or the active vessel isn't an EVA kerbal.
  /**
   * Suit oxygen and charge only fall, and they are read as "what is left right
   * now". A held figure would overstate both, on the two numbers that decide
   * whether a kerbal outside the craft has time to get back in.
   */
  const resourcesReading = topics.useTelemetry("vessel.resources");
  const resources =
    resourcesReading.state === "observed" ? resourcesReading.value : undefined;
  /*
   * `EvaSuitReadout` returns early on this flag and drops both meters, so it
   * has to mean "there is nothing to meter". `vessel.resources` declares no
   * reckonable value, so the observation is the only thing that ever fills the
   * meters and a held reading is exactly the case where nothing was drawn.
   */
  const suitReadingsNotCurrent = notCurrent(resourcesReading);
  const suitOxygen = isEVA
    ? toSuitResourceReadout(resources?.resources?.Oxygen)
    : undefined;
  const suitElectricCharge = isEVA
    ? toSuitResourceReadout(resources?.resources?.ElectricCharge)
    : undefined;

  // Avatar cell width tracks the roster's own measured content width (see
  // `avatarCellSizePx`'s doc comment above for why this is a real
  // `ResizeObserver` measurement, not a viewport-relative `vw` clamp).
  // Called unconditionally, ahead of the `showRoster` early return below, so
  // hook order stays stable across renders regardless of which branch fires.
  const { ref: rosterWidthRef, size: rosterSize } =
    useElementSize<HTMLDivElement>(AVATAR_MEASURE_SEED);
  const avatarSizePx = avatarCellSizePx(rosterSize.w);

  // Per-kerbal row tone (e.g. an Uplink's "this kerbal is critical" signal),
  // see the `crew-status.row-tone` contribution slot's own doc comment
  // above. First-registered entry per name wins, mirroring ShipMap's own
  // `groupByPart` dedupe convention. Called unconditionally alongside the
  // other hooks above, ahead of the `showRoster` early return below.
  const rowToneContributions = useContributions("crew-status.row-tone");
  const rowToneByName = useMemo(() => {
    const map = new Map<string, ReadoutTone>();
    for (const entry of rowToneContributions) {
      if (!map.has(entry.crewName)) {
        map.set(entry.crewName, ROW_TONE_BY_SEVERITY[entry.severity]);
      }
    }
    return map;
  }, [rowToneContributions]);

  const names = toCrewNames(crewRaw);
  const known =
    crewCount !== undefined || crewCapacity !== undefined || names.length > 0;

  // Selective rendering, at very small sizes the roster is dropped in
  // favour of a single big "n / m" headcount readout.
  const cols = w ?? 6;
  const rows = h ?? 8;
  const showRoster = rows >= 5 && cols >= 4;

  if (!showRoster) {
    return (
      <Panel
        panelTitle="CREW"
        sections={
          <Section>
            {known ? (
              <BigReadout $tone="go" style={TINY_READOUT_STYLE}>
                {crewCount !== undefined ? (
                  <Unit value={crewCount} />
                ) : (
                  NULL_DISPLAY
                )}
                {crewCapacity !== undefined && (
                  <ReadoutCaption>
                    of <Unit value={crewCapacity} /> aboard
                  </ReadoutCaption>
                )}
              </BigReadout>
            ) : (
              <EmptyState>No crew data</EmptyState>
            )}
          </Section>
        }
      />
    );
  }

  // Headcount ("N/M aboard") moved off this body-level caption entirely, an
  // info-tone `crew-status.badges` self-contribution (`./badge.ts`) now
  // carries it as a header panel badge instead, the same badge system an
  // Uplink's nogo-tone crew-critical badge already rides. Only the
  // EVA marker is left for this line to carry; when the vessel isn't an EVA
  // kerbal there's nothing left to show, and the line drops entirely.
  const crewSummary = known && isEVA === true ? "EVA" : "";

  return (
    <Panel
      panelTitle="CREW"
      sections={
        <Section>
          {/* Whole-widget status slot: a vessel-level condition (e.g. an
          Uplink's radiation-environment reading), never a per-kerbal one.
          Renders nothing until an Uplink binds it. */}
          <AugmentSlot name="crew-status.summary" props={{}} />
          {crewSummary && <ReadoutCaption>{crewSummary}</ReadoutCaption>}
          <EvaSuitReadout
            oxygen={suitOxygen}
            electricCharge={suitElectricCharge}
            notCurrent={isEVA === true && suitReadingsNotCurrent}
          />
          <div ref={rosterWidthRef}>
            {renderBody({
              known,
              crewCount: crewCount?.magnitude,
              names,
              avatarSizePx,
              rowToneByName,
            })}
          </div>
        </Section>
      }
    />
  );
}

function renderBody({
  known,
  crewCount,
  names,
  avatarSizePx,
  rowToneByName,
}: {
  known: boolean;
  crewCount: number | undefined;
  names: string[];
  avatarSizePx: number;
  rowToneByName: ReadonlyMap<string, ReadoutTone>;
}): React.ReactNode {
  if (!known) return <EmptyState>Waiting for telemetry...</EmptyState>;

  // Only conclude "Unmanned" once the headcount itself has arrived. If
  // `crewCapacity` (or another key) lands before `crewCount`, `known` is
  // already true but `crewCount` is still undefined, treating that as
  // unmanned flashes a wrong "no kerbals aboard" label on a crewed vessel.
  if (crewCount === undefined) {
    return <EmptyState>Waiting for telemetry...</EmptyState>;
  }

  if (crewCount === 0) {
    return <EmptyState>Unmanned, no kerbals aboard.</EmptyState>;
  }

  const rosterListStyle = {
    listStyle: "none",
    margin: "var(--space-8) 0 0",
    padding: 0,
  } as const;

  if (names.length === 0) {
    return (
      <Stack as="ul" gap="sm" style={rosterListStyle}>
        <EmptyState>
          {crewCount} aboard, names unavailable. Crew names can be withheld when
          the vessel is out of CommNet range.
        </EmptyState>
      </Stack>
    );
  }

  // Non-reactive read, augments register at module load, before first render
  // (same convention as FleetRoster's `updatesAugmentPresent`). Gates whether
  // the leading avatar cell is reserved at all: with no Uplink providing
  // avatars, no cell is rendered and that width goes back to the name instead
  // of sitting empty behind a decorative dot that never signalled anything.
  const avatarAugmentPresent =
    getAugmentsForSlot("crew-status.avatar").length > 0;

  return (
    // `gap="lg"` (12px, up from `sm`'s 4px): the between-ROW breathing room
    // operator feedback flagged as too tight. This is the ONLY gap this fix
    // touches, the within-row gaps below (avatar-to-text-block, name-row-to-
    // survival-section) are unrelated and stay as they were.
    <Stack as="ul" gap="lg" style={rosterListStyle}>
      {names.map((name, index) => {
        return (
          // Per-crew row: a padded, rounded `Card` (operator feedback: the
          // previous bare `Stack`/`Cluster` row gave the roster no visual
          // separation between kerbals, which was also why the death-clock
          // badge above read as glued to the meter directly under it rather
          // than owned by the kerbal as a whole). `tone` picks up the
          // `crew-status.row-tone` contribution when an Uplink reports this
          // kerbal critical (`rowToneByName` above); with none bound, or
          // this kerbal not flagged, the card renders with its default
          // untinted border, identical to every other nominal row.
          <Card as="li" key={name} tone={rowToneByName.get(name)}>
            {/* A leading avatar COLUMN (when bound) beside a right-hand
                column carrying the WHOLE rest of the row (name + wrapping
                badge + survival section), not just the name. `align="start"`
                top-aligns the fixed-size avatar square against the top of
                that column rather than centring it against the row as a
                whole, so a tall column (badge wrapped, survival meters
                present) doesn't float the avatar down into its middle. */}
            <Cluster justify="start" align="start">
              {/* Leading per-crew avatar column: a square cell where an
                  Uplink's avatar augment composes, spanning the whole row
                  block (name + badge + survival), not just the name line.
                  Only rendered while an Uplink actually binds this slot;
                  with none bound there is no column at all, see
                  `avatarAugmentPresent` above. */}
              {avatarAugmentPresent && (
                <CrewAvatarCell
                  sizePx={avatarSizePx}
                  slot={
                    <div style={AVATAR_LAYER_STYLE}>
                      {/* Forces whatever the augment renders (e.g. a face
                          image) to fill the cell. Renders blank (not a
                          placeholder) for a kerbal the bound Uplink has
                          nothing to show yet. */}
                      <div style={{ width: "100%", height: "100%" }}>
                        <AugmentSlot
                          name="crew-status.avatar"
                          props={{ crewName: name, crewIndex: index }}
                        />
                      </div>
                    </div>
                  }
                />
              )}
              {/* Right-hand column: name, wrapping badge, and the survival
                  section all stack here, to the right of the avatar (or
                  full-width when no avatar is bound). `flex: 1 1 auto` +
                  `minWidth: 0` (CREW_INFO_STYLE) so it fills the remaining
                  row width and its own `Truncate` child can still shrink to
                  ellipsis rather than overflow. */}
              <Stack gap="sm" style={CREW_INFO_STYLE}>
                <Cluster justify="start" wrap>
                  {/* `flex: 1 1 auto` (not the shared `Truncate`'s default
                      `flex: 1` = `1 1 0%`, overridden via inline `style`
                      since that wins over the class-based rule without a
                      bespoke styled wrapper): the name commands its own
                      natural width in the wrap decision below, so a trailing
                      badge wraps onto its own line instead of shrinking the
                      name into an ellipsis. Still truncates in the rare case
                      the panel itself is too narrow for the name alone. */}
                  <Truncate style={NAME_FLEX_STYLE}>{name}</Truncate>
                  {/* Per-crew inline badges slot. Renders nothing until an
                      Uplink (e.g. a habitation or radiation backend) binds,
                      the props carry this row's kerbal identity so the augment
                      badges the right one. `wrap` on the Cluster above lets
                      this drop to its own line under the name rather than
                      squeeze it; the name's own flex-grow already pushes the
                      badge to the trailing edge when both fit on one line,
                      so no `marginLeft: auto` is needed here. */}
                  <Inline gap="xs">
                    <AugmentSlot
                      name="crew-status.row-badges"
                      props={{ crewName: name, crewIndex: index }}
                    />
                  </Inline>
                </Cluster>
                {/* This kerbal's contributed survival meters (e.g. an
                    Uplink's per-rule dose/stress bars). Renders
                    nothing at all when nothing is contributed, so the roster
                    degrades exactly as it did with an unbound slot. */}
                <WidgetMeters row={name} style={CREW_METERS_STYLE} />
              </Stack>
            </Cluster>
          </Card>
        );
      })}
    </Stack>
  );
}

// The augment slot layer fills the avatar cell and centres its content.
const AVATAR_LAYER_STYLE = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

/**
 * The crew-row name: overrides `Truncate`'s `flex: 1 1 0%` with `flex: 1 1
 * auto` so a trailing badge wraps to its own line instead of shrinking the
 * name (see the row's own comment above). An inline `style` override, not a
 * bespoke `styled(Truncate)` extension: this widget carries zero bespoke CSS
 * (`noRestrictedImports` bans `styled-components` here), and inline `style`
 * already wins over the shared component's class-based rule for the one
 * property being overridden.
 */
const NAME_FLEX_STYLE = { flex: "1 1 auto" } as const;

/**
 * The right-hand column beside the leading avatar: name, wrapping badge, and
 * survival section all stack here. `flex: 1 1 auto` fills the remaining row
 * width once the avatar column (sized via `avatarCellSizePx`) takes its
 * share; `minWidth: 0` is the standard flex-child fix that lets its own
 * `Truncate` child actually shrink to ellipsis instead of forcing the row
 * wider. With no avatar bound this column is the row's only flex child, so
 * it still spans the full width, same as before this column existed.
 */
const CREW_INFO_STYLE = { flex: "1 1 auto", minWidth: 0 } as const;

/** Indents a row's contributed meters under the kerbal's name, and keeps a gap
 *  before the next roster row. Carried on the stack itself rather than on a
 *  wrapper here, so a kerbal with no meters leaves no padding behind. */
const CREW_METERS_STYLE = {
  paddingBottom: "var(--space-4)",
  paddingLeft: "var(--space-12)",
} as const;

/**
 * Leading per-crew avatar cell: a square that reserves room for an avatar-face
 * augment, sized in JS pixels via `sizePx` (`avatarCellSizePx`, computed once
 * per render off the roster's measured width, see that helper's own doc
 * comment). `position: relative` so the augment slot layer fills the box.
 * Only rendered while `avatarAugmentPresent` (`renderBody`, above) is true,
 * so this component never has to fall back to placeholder content.
 */
function CrewAvatarCell({
  slot,
  sizePx,
}: Readonly<{ slot: ReactNode; sizePx: number }>) {
  return (
    <div
      data-testid="crew-avatar-cell"
      style={{
        position: "relative",
        flex: "0 0 auto",
        width: `${sizePx}px`,
        height: `${sizePx}px`,
      }}
    >
      {slot}
    </div>
  );
}

registerComponent<CrewStatusConfig>({
  id: "crew-status",
  name: "Crew Status",
  description:
    "Kerbals aboard the active vessel, count vs capacity + full roster. Shows EVA state and handles unmanned probes gracefully.",
  tags: ["telemetry", "crew"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 3 },
  component: CrewStatusComponent,
  // Per-crew-row augment slots, all unfilled until an Uplink
  // binds, the roster renders as before:
  //   crew-status.row-badges, trailing inline badges (e.g. dose/comfort);
  //     wraps under the name (Cluster `wrap`) rather than truncating it.
  //   crew-status.avatar, leading square face cell (Uplink-provided avatar); only
  //     reserved while an Uplink actually binds it, see `avatarAugmentPresent`.
  //   crew-status.summary, ONE whole-widget section above the roster (e.g. a
  //     vessel-wide radiation-environment reading), not per-kerbal, see
  //     that slot's own doc comment above.
  //
  // The per-row survival section is NOT here: it is the framework's universal
  // `crew-status.meters` CONTRIBUTION segment now, drawn by `<WidgetMeters>`
  // per roster row. It stopped being an augment because the Uplink filling it
  // was rendering a stack of the kit's own `Meter` and nothing else.
  augmentSlots: [
    "crew-status.row-badges",
    "crew-status.avatar",
    "crew-status.summary",
  ],
  // `crew-status.row-tone`: the only slot this widget declares that carries
  // DATA rather than JSX, see its own doc comment above. (`crew-status.meters`
  // is a contribution too, but it is the framework's universal segment and no
  // widget declares it.) Fed by nothing when no Uplink binds, every row's
  // `Card` renders with the default untinted border.
  contributionSlots: ["crew-status.row-tone"],
  channels: topics.channels,
  fields: topics.fields,
  // `vessel.resources` is the (already-existing, already-consumed-by-
  // FuelStatus) generic per-vessel resource Topic; here it feeds the EVA
  // suit O2/EC readout, only relevant while the active vessel is an EVA
  // kerbal. `optionalChannels` (not `channels`): the widget's core roster
  // reads always work without it, so it must never gate the whole widget's
  // mount the way a REQUIRED `channels` entry would (see `RequiresGuard`'s
  // own doc comment on the distinction).
  optionalChannels: topics.optionalChannels,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CrewStatusComponent };
