import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getAugmentsForSlot,
  registerComponent,
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
  Cluster,
  EmptyState,
  Inline,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Stack,
  Text,
  Truncate,
  Unit,
  useElementSize,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { magnitudeOf, type Quantityish } from "../shared/magnitude";
// Side-effect import: the widget's own `crew-status.badges` panel-badge
// self-contribution (the info-tone "N/M aboard" header chip) registers on
// module load, see that file's own doc comment for why it lives apart from
// the per-row AugmentSlot declarations below.
import "./badge";

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

/** Pure size calc, unit-testable with no DOM: clamp a fraction of the
 *  measured roster width between the cell's min/max bounds. */
/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

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
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

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

// -----------------------------------------------------------------------
// EVA suit resources (additive; only meaningful while the active vessel IS
// an EVA kerbal). A stock KSP EVA kerbal is a real Vessel with its own
// resource-carrying Part (Kerbalism source, System/Callbacks.cs's
// ToEVA/DelayedOnEVA on GameEvents.onCrewOnEva), so the already-existing,
// already-consumed `vessel.resources` Topic (see FuelStatus) works against
// it unchanged - no new wire protocol needed. Kerbalism's default profile
// (GameData/KerbalismConfig/Profiles/Default.cfg) attaches exactly two
// resources with a nonzero `on_eva`: ElectricCharge and Oxygen. Read here as
// plain resource-name lookups, no Kerbalism-specific shape.
// -----------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The `crew-status.badges` slot contract (see augment-slot-map)
//
// A per-crew-row inline badges slot: a future Kerbalism `Habitat`/`Radiation`
// Uplink can badge each kerbal with comfort/radiation-dose without leaving this
// widget. Because the slot renders once PER ROW, its props MUST carry the crew
// member's identity so the augment badges the right kerbal, `crewName` is that
// identity (the only per-kerbal handle exposed here), and
// `crewIndex` disambiguates in the (legal) case of two kerbals sharing a name.
// ---------------------------------------------------------------------------

/** Props passed to every `crew-status.badges` augment, one per crew row. */
export interface CrewBadgeContext {
  /** The crew member this badge row belongs to, its identity for the augment. */
  crewName: string;
  /** Position in the roster; disambiguates duplicate names. */
  crewIndex: number;
}

// Declaration-merge the slot id → props type into core's `SlotRegistry`.
// Co-located here (not in a shared central file) so parallel slot work in
// other widgets can't collide. Makes `registerAugment({ augments:
// "crew-status.badges" })` and `<AugmentSlot name="crew-status.badges"
// props={...} />` type-check precisely against `CrewBadgeContext`.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "crew-status.badges": CrewBadgeContext;
  }
}

// ---------------------------------------------------------------------------
// The `crew-status.avatar` slot contract (see augment-slot-map)
//
// A per-crew-row LEADING square cell (left of the name): the SDK-independent
// shell of a per-kerbal avatar/portrait. An Uplink can register an augment
// that fills it with a live face, keyed by kerbal identity. Same per-row
// keying as `crew-status.badges`, `crewName` is the augment's identity
// handle and `crewIndex` disambiguates duplicate names. The cell itself is
// only reserved while at least one augment is bound to this slot at all
// (`avatarAugmentPresent`, `renderBody` below); with no avatar-providing
// Uplink installed, no cell is rendered and the row's leading space goes to
// the name instead, not a same-size empty placeholder. Once an Uplink IS
// providing avatars, the cell renders as usual, and for any one kerbal that
// Uplink has nothing to show for (avatar source disabled, kerbal not seated),
// the cell renders blank rather than a placeholder: the avatar augment is
// entirely optional, both at the slot level and per-kerbal.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The `crew-status.survival` slot contract (see augment-slot-map)
//
// A per-crew-row section slot, directly below each roster row: the generic
// home for a per-kerbal survival readout (death clock, worst rule, degen).
// This widget carries NO Kerbalism-specific reads itself (it used to, the
// Kerbalism crew-rules and life-support Topics were read inline here; that
// contaminated the vanilla roster with a Kerbalism concept and has moved
// wholesale to the Kerbalism Uplink's own `crew-status-survival` augment,
// mod/GonogoKerbalismUplink/client/src/CrewSurvival). Same per-row keying as
// `crew-status.badges`/`.avatar`: `crewName` is the augment's identity
// handle, `crewIndex` disambiguates duplicate names. Renders nothing when no
// augment is bound (no Uplink, or the Uplink has nothing to show for this
// kerbal), so the roster degrades gracefully exactly like the avatar slot.
// ---------------------------------------------------------------------------

/** Props passed to every `crew-status.survival` augment, one per crew row. */
export interface CrewSurvivalSlotContext {
  /** The crew member this row belongs to, its identity for the augment. */
  crewName: string;
  /** Position in the roster; disambiguates duplicate names. */
  crewIndex: number;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "crew-status.survival": CrewSurvivalSlotContext;
  }
}

// ---------------------------------------------------------------------------
// The `crew-status.summary` slot contract (see augment-slot-map)
//
// A WHOLE-WIDGET section slot, rendered once above the roster rather than
// once per kerbal: the generic home for a status that affects the whole
// crew together, not any one of them individually (e.g. a Kerbalism vessel
// radiation-environment reading). Unlike `.badges`/`.avatar`/`.survival`
// above, this carries no per-kerbal identity, there is exactly one instance
// of it per widget, mirroring `ThermalStatus`'s `thermal-status.badges`
// slot (`ThermalStatus/index.tsx`): no props, an empty object contract.
// Renders nothing when no augment is bound, so the roster degrades
// gracefully exactly like the other slots.
// ---------------------------------------------------------------------------

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
 * the Kerbalism case) is exactly what parses `CrewMember` entries too, no
 * shape fix needed.
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
   * down the same record are the opposite and go through `judgeable`.
   */
  const crewReading = useTelemetry("vessel.crew");
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
  const resourcesReading = useTelemetry("vessel.resources");
  const resources = judgeable(resourcesReading);
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
      <Panel panelTitle="CREW">
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
      </Panel>
    );
  }

  // Headcount ("N/M aboard") moved off this body-level caption entirely, an
  // info-tone `crew-status.badges` self-contribution (`./badge.ts`) now
  // carries it as a header panel badge instead, the same badge system the
  // Kerbalism Uplink's nogo-tone crew-critical badge already rides. Only the
  // EVA marker is left for this line to carry; when the vessel isn't an EVA
  // kerbal there's nothing left to show, and the line drops entirely.
  const crewSummary = known && isEVA === true ? "EVA" : "";

  return (
    <Panel panelTitle="CREW">
      {/* Whole-widget status slot: a vessel-level condition (e.g. the
          Kerbalism Uplink's radiation-environment reading), never a
          per-kerbal one. Renders nothing until an Uplink binds it. */}
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
        })}
      </div>
    </Panel>
  );
}

function renderBody({
  known,
  crewCount,
  names,
  avatarSizePx,
}: {
  known: boolean;
  crewCount: number | undefined;
  names: string[];
  avatarSizePx: number;
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
          <li key={name}>
            {/* Per-crew row: a leading avatar COLUMN (when bound) beside a
                right-hand column carrying the WHOLE rest of the row (name +
                wrapping badge + survival section), not just the name.
                `align="start"` top-aligns the fixed-size avatar square
                against the top of that column rather than centring it
                against the row as a whole, so a tall column (badge wrapped,
                survival meters present) doesn't float the avatar down into
                its middle. */}
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
                      Uplink (e.g. Kerbalism Habitat/Radiation) binds, the
                      props carry this row's kerbal identity so the augment
                      badges the right one. `wrap` on the Cluster above lets
                      this drop to its own line under the name rather than
                      squeeze it; the name's own flex-grow already pushes the
                      badge to the trailing edge when both fit on one line,
                      so no `marginLeft: auto` is needed here. */}
                  <Inline gap="xs">
                    <AugmentSlot
                      name="crew-status.badges"
                      props={{ crewName: name, crewIndex: index }}
                    />
                  </Inline>
                </Cluster>
                {/* Per-crew survival section slot. Renders nothing until an
                    Uplink (e.g. Kerbalism) binds; this widget carries no
                    Kerbalism-specific data itself, see the slot's own doc
                    comment above. */}
                <AugmentSlot
                  name="crew-status.survival"
                  props={{ crewName: name, crewIndex: index }}
                />
              </Stack>
            </Cluster>
          </li>
        );
      })}
    </Stack>
  );
}

// ── Avatar cell ──────────────────────────────────────────────────────────────

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

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<CrewStatusConfig>({
  id: "crew-status",
  name: "Crew Status",
  description:
    "Kerbals aboard the active vessel, count vs capacity + full roster. Shows EVA state and handles unmanned probes gracefully.",
  tags: ["telemetry", "crew"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 3 },
  component: CrewStatusComponent,
  // Per-crew-row augment slots (augment-slot-map). All unfilled until an Uplink
  // binds, the roster renders as before:
  //   crew-status.badges, trailing inline badges (e.g. Kerbalism dose/comfort);
  //     wraps under the name (Cluster `wrap`) rather than truncating it.
  //   crew-status.avatar, leading square face cell (Uplink-provided avatar); only
  //     reserved while an Uplink actually binds it, see `avatarAugmentPresent`.
  //   crew-status.survival, per-row survival section (e.g. Kerbalism death
  //     clock/worst rule), see that slot's own doc comment above. This widget
  //     carries no Kerbalism-specific reads itself; the per-kerbal survival
  //     model lives entirely in the Kerbalism Uplink's own Processor/augment
  //     (mod/GonogoKerbalismUplink/client/src/CrewSurvival).
  //   crew-status.summary, ONE whole-widget section above the roster (e.g. a
  //     Kerbalism vessel radiation-environment reading), not per-kerbal, see
  //     that slot's own doc comment above.
  augmentSlots: [
    "crew-status.badges",
    "crew-status.avatar",
    "crew-status.survival",
    "crew-status.summary",
  ],
  dataRequirements: [
    "vessel.crew.crew",
    "vessel.crew.count",
    "vessel.crew.capacity",
    "vessel.state.isEVA",
  ],
  // `vessel.resources` is the (already-existing, already-consumed-by-
  // FuelStatus) generic per-vessel resource Topic; here it feeds the EVA
  // suit O2/EC readout, only relevant while the active vessel is an EVA
  // kerbal. `optionalChannels` (not `channels`): the widget's core roster
  // reads always work without it, so it must never gate the whole widget's
  // mount the way a REQUIRED `channels` entry would (see `RequiresGuard`'s
  // own doc comment on the distinction).
  optionalChannels: ["vessel.resources"],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CrewStatusComponent };
