// ---------------------------------------------------------------------------
// Contribution-registry mirror: the `ContributionRegistry` declaration-merge
// for every first-party (packages/components-owned) contribution slot,
// carried by the sdk leaf itself. Same reasoning, same file-identity caveat,
// same "components-owned only, Uplink-owned slots stay in the Uplink's own
// file" scope split as `slots.ts` (see that file's header for the long
// form).
//
// Merges into the `ContributionRegistry {}` base declared in `./types.ts`,
// exactly like `slots.ts` merges into that file's `SlotRegistry {}` base: TS
// module augmentation with a relative specifier only attaches to an EXISTING
// export of the target module (an augmentation of a name types.ts hasn't
// declared is instead treated as a brand new ambient module declaration,
// which TS rejects outright for a relative path), so the base interface has
// to live in types.ts itself even while it stays empty.
//
// The `export {}` below is load-bearing, not decorative: it is what makes
// this FILE a module in TS's eyes. `slots.ts` gets that status for free from
// its own top-level `export interface` declarations (its real slot context
// types); this scaffold has no such content yet, so without an explicit
// export TS would treat it as a global script and reject the relative
// `declare module` specifier below with "Ambient module declaration cannot
// specify relative module name". Drop this line once the first real
// contribution slot's context type gives the file a natural export.
//
// The first two first-party contribution slots landed here (the
// framework's self-contribution flagship): ShipMap's `ship-map.part-meters`
// and `ship-map.part-meta`, both owned by `packages/components/src/ShipMap`.
// Every OTHER first-party contribution to date rides the automatic
// `${componentId}.badges` slot, which is a runtime string, never a member of
// this declaration-merged registry (see `useWidgetBadges`'s own doc
// comment); these two are the first GENUINELY typed, declared slots.
//
// `MeterTone` is duplicated rather than imported from `@ksp-gonogo/ui-kit`:
// ui-kit's own `Meter.tsx` imports `value` from this package, so importing
// ui-kit back here would be the exact same leaf-cycle this file's header
// (and `./slots.ts`'s) already explains for `@ksp-gonogo/components`.
//
// `ShipMapPartMeterEntry` deliberately carries no `tone`: the meter's fill is
// the resource's IDENTITY colour, derived by the renderer from `resource` via
// ui-kit's `resourceColor`, never chosen by a contributor. `status` is the
// SEPARATE, level-driven signal (a border tint or badge), and a single `tone`
// would conflate it with the fill hue. `ShipMapPartMetaEntry` does carry a
// `tone`: that is a different kind of row (process running/broken, habitat
// pressure, ...) whose tone genuinely is a state rather than an identity.
// ---------------------------------------------------------------------------

import type { Reading } from "../reading";
import type { ReadFrameChoice } from "../spine/reference-frame";
import type { Value } from "../unit-system/value";
import type { AlertTone, Tone } from "./tone";
import type { BadgeEntry, MeterEntry, StatEntry } from "./types";

/**
 * One resource meter on a part of the Ship Map, contributed to
 * `ship-map.part-meters`.
 *
 * The Ship Map draws each entry as a fill bar on the part and as a meter in the
 * part's tooltip. The fill colour is the resource's own colour, chosen by the
 * widget from `resource`; `status` is the only signal a contributor adds to it.
 * The first entry for a given `partId` and `resource` is drawn and any later one
 * is ignored.
 *
 * @category Widget slots
 */
export interface ShipMapPartMeterEntry {
  /** The part's `flightId`, as a decimal string. */
  partId: string;
  /** The resource name as KSP spells it, such as `"LiquidFuel"`. Picks the fill colour. */
  resource: string;
  /** The meter's label in the tooltip. */
  displayName: string;
  /**
   * The amount stored, as a quantity or as the whole {@link Reading} of one.
   * Passing the reading lets the meter show when the figure is held rather than
   * current, and mark the reading's band on the bar.
   */
  amount: Value<"units"> | Reading<Value<"units">>;
  /**
   * The part's capacity for this resource, in the same terms as `amount`. An
   * entry whose capacity is not positive is not drawn.
   */
  capacity: Value<"units"> | Reading<Value<"units">>;
  /**
   * A level warning drawn as a tint on the bar's outline: `"low"` or
   * `"critical"`. Null or absent means the level is fine. The contributor picks
   * its own thresholds.
   */
  status?: "low" | "critical" | null;
}

/**
 * One status row on a part of the Ship Map that is not a stored resource, such
 * as a converter's efficiency or a habitat's pressure, contributed to
 * `ship-map.part-meta`.
 *
 * Drawn in the part's tooltip, after its resource meters. The first entry for a
 * given `partId` and `label` is drawn and any later one is ignored.
 *
 * @category Widget slots
 */
export interface ShipMapPartMetaEntry {
  /** The part's `flightId`, as a decimal string. */
  partId: string;
  /** The row's label, such as `"Water Recycler"`. */
  label: string;
  /** The status colour of a `"ratio"` row's meter. */
  tone: Tone;
  /** `"ratio"` draws `value` as a meter; `"text"` draws `text` beside the label. */
  kind: "ratio" | "text";
  /** A fraction from 0 to 1, read when `kind` is `"ratio"`. Absent draws an empty meter. */
  value?: number;
  /** Free text, read when `kind` is `"text"`. */
  text?: string;
}

/**
 * The bitrate of one hop on the comms route, contributed to
 * `comm-signal.hop-rates`.
 *
 * Comm Signal joins each entry onto the hop of the `comms.path` route with the
 * same `fromNodeId` and `toNodeId`, shows the rate beside it, and marks the
 * slowest hop once at least two hops carry a rate. An entry naming a hop that
 * is not on the route is not drawn.
 *
 * @category Widget slots
 */
export interface CommSignalHopRateEntry {
  /** The hop's sending node id, exactly as `comms.path` names it. */
  fromNodeId: string;
  /** The hop's receiving node id, exactly as `comms.path` names it. */
  toNodeId: string;
  /** The hop's forward data rate in bits per second. */
  bitsPerSec: number;
}

/**
 * How strongly a System View entity is drawn when its style names no tone
 * or colour: `"faint"` is dim, `"normal"` is the default, `"bright"` stands out.
 *
 * @category Widget slots
 */
export type SystemEntityEmphasis = "faint" | "normal" | "bright";

/**
 * How a System View entity is drawn. Every field is optional.
 *
 * @category Widget slots
 */
export interface SystemEntityStyle {
  /** Brightness and opacity; `"normal"` when absent. Sets the colour too when `tone` is absent. */
  emphasis?: SystemEntityEmphasis;
  /** Colours the entity by meaning, so the theme reaches it. Takes precedence over `emphasis` for colour. */
  tone?: AlertTone;
  /**
   * A CSS colour that overrides both of the above. Set by the widget itself,
   * for instance to show a selection; a contribution names `tone` instead.
   */
  colour?: string;
}

/**
 * Label and value rows for a System View entity, keyed by label. They are the
 * entity's accessible name, joined as `label: value`, and fall back to its `id`
 * when empty.
 *
 * @category Widget slots
 */
export type SystemEntityMeta = Readonly<
  Record<string, string | number | boolean>
>;

/**
 * A place on a Keplerian orbit around a named body. `trueAnomaly` picks the
 * point on it; a shape that draws the whole orbit ignores it.
 *
 * @category Widget slots
 */
export interface SystemEntityOrbitPosition {
  kind: "orbit";
  /** The body orbited. Matched without regard to case or surrounding space; the entity is not drawn unless this is the body the diagram is centred on. */
  parentName: string;
  /** Semi-major axis, in metres. Not drawn unless positive and finite. */
  sma: number;
  /** Eccentricity. */
  ecc: number;
  /** Longitude of the ascending node, in degrees. */
  lan: number;
  /** Argument of periapsis, in degrees. */
  argPe: number;
  /** Inclination to the parent's reference plane, in degrees. Required: an equatorial orbit says `0`. */
  inclination: number;
  /** True anomaly, in degrees. */
  trueAnomaly: number;
}

/**
 * A place given as an offset from a named body's centre, for anything that is
 * not on an orbit.
 *
 * @category Widget slots
 */
export interface SystemEntityFixedPosition {
  kind: "fixed";
  /** The body the offset is measured from. Matched as for {@link SystemEntityOrbitPosition.parentName}. */
  parentName: string;
  /** Offset along the parent's reference plane, in metres. */
  xMetres: number;
  /** Offset along the parent's reference plane, at right angles to `xMetres`, in metres. */
  yMetres: number;
  /** Offset out of the parent's reference plane, in metres. Required: a point in the plane says `0`. */
  zMetres: number;
}

/**
 * Where a System View entity is: on an orbit, or at a fixed offset from a body.
 * An entity whose position holds a non-finite number is not drawn.
 *
 * @category Widget slots
 */
export type SystemEntityPosition =
  | SystemEntityOrbitPosition
  | SystemEntityFixedPosition;

/**
 * What a System View entity looks like, by `kind`:
 *
 * - `"point"`: a marker of `radiusPx` screen pixels, 4 when absent
 * - `"orbit-path"`: the whole ellipse of the entity's `position`, which must be an orbit
 * - `"connection-line"`: a line from the entity's `position` to `to`
 * - `"blob"`: a disc of `radiusMetres`, which grows and shrinks with zoom
 * - `"travelling-pulse"`: a segment `segmentLengthMetres` long moving once from `position` toward `to`, its leading edge reaching `to` at UT `arriveUt` and its trailing edge clearing it at UT `clearUt`, in seconds
 *
 * Drawn back to front as orbit paths, then blobs and pulses, then lines, then
 * points, unless the entity sets `zHint`.
 *
 * @category Widget slots
 */
export type SystemEntityShape =
  | { kind: "point"; radiusPx?: number }
  | { kind: "orbit-path" }
  | { kind: "connection-line"; to: SystemEntityPosition }
  | { kind: "blob"; radiusMetres: number }
  | {
      kind: "travelling-pulse";
      to: SystemEntityPosition;
      segmentLengthMetres: number;
      /** UT the leading edge reaches `to`, in seconds. */
      arriveUt: number;
      /** UT the trailing edge fully clears `to`, in seconds. */
      clearUt: number;
    };

/**
 * One thing drawn on the System View diagram, contributed to
 * `system-view.entities`: a vessel's orbit, a link, a marker, a travelling
 * front.
 *
 * A contribution returns plain positions and shapes; the widget projects them
 * into the frame it is drawing, at its own pan and zoom. An entity whose parent
 * is not the body the diagram is centred on is not drawn.
 *
 * @category Widget slots
 */
export interface SystemEntity {
  /** Stable id, unique across every contributor. Selection and the info panel key off it. */
  id: string;
  /** Where the entity is. */
  position: SystemEntityPosition;
  /** What is drawn there. */
  shape: SystemEntityShape;
  /** How it is drawn; `"normal"` emphasis when absent. */
  style?: SystemEntityStyle;
  /** Rows describing the entity, shown when it is selected. */
  meta?: SystemEntityMeta;
  /** The `vesselId` from `system.vessels` when the entity is a vessel, so the widget matches it to the vessel by identity. */
  vesselId?: string;
  /** Stacking order that overrides the shape's default layer; higher is in front. Ties keep contribution order. */
  zHint?: number;
}

/**
 * A contact status for one vessel on the System View diagram, contributed to
 * `system-view.vessel-status`.
 *
 * The widget reads the entry whose `target` is the vessel it is plotting. It
 * restyles that vessel's marker and captions the diagram with the vessel's name
 * followed by `label`, lower-cased. A `"nogo"` caption is announced to
 * screen readers at once, a `"warn"` one politely, and an `"info"` one not
 * at all.
 *
 * @category Widget slots
 */
export interface SystemViewVesselStatusEntry {
  /** The vessel this entry is about: its `vesselId` from `vessel.identity`. */
  target: string;
  /** `"info"` draws the marker as predicted, `"warn"` as overdue, `"nogo"` as lost. */
  tone: AlertTone;
  /** `"observed"` for a status seen directly, which keeps the plain marker; `"reckoned"` for one inferred by a model, which applies `tone`. */
  emphasis: "observed" | "reckoned";
  /** The caption text after the vessel's name, such as `"Officially lost"`. */
  label: string;
  /** Longer detail about the status. The widget does not draw it. */
  tooltip?: string;
}

/**
 * How big a System View projection draws, by `kind`: `"auto-fit-metres"` fits
 * the drawn orbits about the frame body, for coordinates in metres centred on
 * it; `"fixed-units"` holds a half-extent of `units` in the projection's own
 * coordinates.
 *
 * @category Widget slots
 */
export type SystemProjectionExtent =
  | { kind: "auto-fit-metres" }
  | { kind: "fixed-units"; units: number };

/**
 * One reference frame the System View can draw its whole picture in,
 * contributed to `system-view.projection`. The operator picks among the entries
 * offered for the body the diagram is centred on.
 *
 * @category Widget slots
 */
export interface SystemViewProjection {
  /** Stable id. The operator's pinned choice is saved as this. */
  id: string;
  /** What the operator reads in the frame picker. */
  label: string;
  /** The frame, resolved by the widget at the instant it draws. */
  choice: ReadFrameChoice;
  /** How big the picture is in this frame. */
  extent: SystemProjectionExtent;
  /** The `system.bodies` index of the body the diagram must be centred on for this projection to be offered. */
  frameBodyIndex: number;
}

/**
 * How alarming one kerbal's situation is, contributed to `crew-status.row-tone`.
 * Crew Status tints that kerbal's whole row by `tone`, and the first entry
 * for a name is the one drawn. Contribute nothing for a kerbal with nothing to
 * report, rather than an `"info"` entry.
 *
 * @category Widget slots
 */
export interface CrewRowToneEntry {
  /** The kerbal's name, matched to a roster row. */
  crewName: string;
  /** How alarming the situation is. The widget picks the colour. */
  tone: AlertTone;
}

/**
 * One screen of the Administration Building, contributed to
 * `strategies.screens`: a tab that lists some strategy departments.
 *
 * With no entries, the widget draws every strategy in one list. With entries,
 * it draws one tab per screen, sorted by `order`, and adds an "Other" tab for
 * any strategy whose department no screen lists. The first entry for an `id` is
 * the one drawn. What a screen contains beyond its strategy cards is drawn by
 * augments on `strategies.screen-body`, which receive the screen's `id`.
 *
 * @category Widget slots
 */
export interface StrategiesScreenEntry {
  /** Stable id, passed to `strategies.screen-body` augments as `screenId`. */
  id: string;
  /** The tab's label, such as `"Programs"`. */
  label: string;
  /** Sort position, ascending; ties keep contribution order. A screen without one sorts after every screen that has one. */
  order?: number;
  /** The department names whose strategies this screen lists, matched against each strategy's department in `career.status`. None lists nothing, leaving the screen to its augments. */
  departments?: readonly string[];
  /**
   * `false` for a screen that exists but cannot be used yet. Its tab is still
   * drawn and can still be opened, and shows `disabledReason` instead of its
   * contents. Absent or `true` means the screen is usable.
   */
  enabled?: boolean;
  /** Why the screen cannot be used, in the operator's terms. `"Not available yet"` when absent. */
  disabledReason?: string;
  /**
   * True when the screen's own `strategies.screen-body` already carries the
   * activate/deactivate verbs for its cards (e.g. a Programs screen offering
   * Accept and Complete), so the host draws that screen's Active and
   * Available cards with no Activate or Deactivate button of its own, rather
   * than one that could only ever be refused.
   */
  drawsOwnActions?: boolean;
}

/** Mirrors `MissionLogAmount`. */
export interface MissionLogAmount {
  readonly magnitude: number;
  /** The contract unit, e.g. `"funds"`, `"rep"`. */
  readonly unit: string;
}

/** Mirrors `MissionLogSourceState`. */
export type MissionLogSourceState =
  | "recording"
  | "not-recording"
  | "unreadable";

/** Mirrors `MissionLogEventEntry`. */
export interface MissionLogEventEntry {
  id: string;
  /** An INSTANT, so a UT, in seconds. */
  ut: number;
  label: string;
  detail?: string;
  /** Short chip text, e.g. "FAILURE"; upper-cased by the host, "LOG" when absent. */
  kindLabel?: string;
  /** How alarming the entry is. */
  tone?: AlertTone;
  /**
   * A figure the row moved: what a leader cost, what a contract paid in
   * reputation.
   *
   * Typed rather than formatted into `detail`, so the HOST renders it through
   * `Unit` and a contributor never hand-formats a quantity. A magnitude and its
   * unit rather than a `Value`, because the two sides of this mirror must
   * declare structurally IDENTICAL types to merge, and a `Value` resolved
   * through two different module paths is not identical to itself; the same
   * reason `MeterTone` is duplicated above. A contributor can pass a contract
   * `Value` straight in, since it already has both members.
   *
   * Singular, because no career-log row carries two figures.
   */
  amount?: MissionLogAmount;
  /**
   * The occurrence several rows belong to. Rows sharing one are marked, so a
   * failure and the launch it happened on can be seen to be the same flight.
   */
  groupId?: string;
}

/**
 * One science instrument aboard the active vessel that the Experiments widget
 * cannot see on the stock `science.instruments` list, contributed to
 * `experiments.instruments`. This is how a mod whose parts run their own
 * science module, rather than the stock one, gets its instruments listed.
 *
 * The widget groups contributed instruments under a heading naming the
 * contributing Uplink, then by `expId`, and counts them in the vessel's totals.
 * It draws a badge per flag: DATA, DEPLOYED, ONE-SHOT when not `rerunnable`,
 * and INOPERABLE. Contributed rows are read-only, with no Deploy or Transmit
 * control, because those commands reach only stock science parts, and they
 * get no `experiments.instrument` augment. An entry whose `partId` is already on
 * the stock list, or already contributed, is dropped.
 *
 * All four flags are required. An instrument with no such lifecycle states it
 * plainly: a scanner that can be neither deployed nor made inoperable says
 * `false` to both and `true` to `rerunnable`.
 *
 * @category Widget slots
 */
export interface ExperimentsInstrumentEntry {
  /** The part's flight id as a string, the same form the stock list uses. Unique across the vessel's instruments. */
  partId: string;
  /** The row's label, such as `"2HOT Thermometer"`. */
  partTitle: string;
  /** KSP experiment id, such as `"temperatureScan"`. Rows with the same id are grouped. */
  expId: string;
  /** The instrument has been deployed. */
  deployed: boolean;
  /** The instrument holds data that can be collected. */
  hasData: boolean;
  /** The instrument can be run again after it has run once. */
  rerunnable: boolean;
  /** The instrument cannot be used. */
  inoperable: boolean;
}

/**
 * One building of the space centre and its upgrade tiers, contributed to
 * `space-center-status.facilities`.
 *
 * Tiers are KSP's own zero-based facility levels, the same index
 * `career.status.facilities` carries. The widget adds one for display, so a
 * contributor passes the index through unchanged. Both tiers are required: a
 * building whose tier could not be read is left out, never sent at tier 0. The
 * first entry for a `facility` is the one drawn.
 *
 * @category Widget slots
 */
export interface SpaceCenterFacilityEntry {
  /**
   * KSP's `SpaceCenterFacility` name: `"LaunchPad"`, `"Runway"`,
   * `"VehicleAssemblyBuilding"`, `"SpaceplaneHangar"`, `"MissionControl"`,
   * `"TrackingStation"`, `"Administration"`, `"ResearchAndDevelopment"` or
   * `"AstronautComplex"`. Any other name is not drawn.
   */
  facility: string;
  /** The tier the building is at, zero-based. */
  currentTier: number;
  /** The top tier's own index, so a three-tier building says 2. */
  maxTier: number;
  /**
   * The next tier's price, in funds. Absent at the top tier and when the price
   * cannot be read; either way the widget shows no price and no upgrade control.
   */
  upgradeCost?: number;
  /**
   * KSP's description of the current tier as its upgrade dialog writes it:
   * newline-separated `* Property: setting` lines. The widget lists each
   * property; a line it cannot read as one is shown as written.
   */
  currentTierText?: string;
  /** The same, for the tier an upgrade would buy. */
  nextTierText?: string;
}

// The plot SUBJECTS `packages/components` draws, declared so a contributor
// enriching one gets it as a completion and a typo fails to compile rather than
// quietly making a second plot. Same reasoning as the slot ids below, one
// registry per declaration-merge seam.
declare module "./plots" {
  interface PlotSubjectRegistry {
    /** LandingStatus's velocity-height descent corridor: speed across, height
     *  above ground up. The suicide-burn band and any better terminal-velocity
     *  model belong on this one rather than beside it. */
    "descent-envelope": true;
    /** The terrain slice along the ground track through the predicted site. */
    "landing-cross-section": true;
    /** The top-down view around the predicted touchdown point. */
    "touchdown-site": true;
  }
}

declare module "./types" {
  interface ContributionRegistry {
    /*
     * A slot declares the entry its contributors produce, and nothing about the
     * data they read. A contribution asks for Topics through its own `deps`, any
     * Topic is valid there, and `deps` is the only thing that feeds `compute`.
     */
    "ship-map.part-meters": {
      entry: ShipMapPartMeterEntry;
    };
    "ship-map.part-meta": {
      entry: ShipMapPartMetaEntry;
    };
    "system-view.entities": {
      entry: SystemEntity;
    };
    "system-view.vessel-status": {
      entry: SystemViewVesselStatusEntry;
    };
    "system-view.projection": {
      entry: SystemViewProjection;
    };
    /**
     * Tints a whole crew row by tone; the widget picks the colour. The
     * first entry for a name wins.
     */
    "crew-status.row-tone": {
      entry: CrewRowToneEntry;
    };
    /**
     * Meters under each crew row, such as life-support levels. Set `row` to the
     * kerbal's name; an entry with no `row` is not drawn.
     */
    "crew-status.meters": {
      entry: MeterEntry;
    };
    "comm-signal.hop-rates": {
      entry: CommSignalHopRateEntry;
    };
    "strategies.screens": {
      entry: StrategiesScreenEntry;
    };
    "experiments.instruments": {
      entry: ExperimentsInstrumentEntry;
    };
    /**
     * The Astronaut Complex's core-stat strip, beside funds, hire price and
     * roster occupancy: what the career model running the save considers as core
     * as those three. Drawn by the host's own `Stat`, in the same cell treatment
     * and the same row, so a contributed figure is indistinguishable from a
     * vanilla one.
     *
     * The strip is where an operator reads the state of the whole complex, and a
     * career overhaul owns half of that state: how many nauts are in training,
     * how many qualifications are about to lapse.
     */
    "astronaut-complex.readouts": {
      entry: StatEntry;
    };
    /**
     * The tiers SpaceCenterStatus draws in its facility grid.
     *
     * <para>The widget contributes its own reading of `career.status` here at
     * priority 0, so an ordinary contributor DISPLACES the grid rather than
     * adding a second copy of it below. That is what the slot is for: away from
     * the space centre the stock reading has nothing to give, and a career model
     * that keeps its own tier table does.</para>
     *
     * <para>KSP puts the space centre's buildings in the SPACECENTER scene only,
     * and stock offers no way round it. `ProtoUpgradeable.GetLevel()` does parse
     * the level persisted in the save when the scene is empty, but its sibling
     * `GetLevelCount()` returns -1 there, and that level is NORMALISED: without
     * a tier count it cannot be turned back into a tier. A career overhaul that
     * carries its own tier counts (RP-1 parses the CustomBarnKit upgrade lists
     * at load and bills the career off them in all four scenes) can report
     * tiers wherever the operator is standing.</para>
     */
    "space-center-status.facilities": {
      entry: SpaceCenterFacilityEntry;
    };
    /**
     * Badges in the screen header's status strip, drawn on the main screen and
     * on every station alike: a fact about the whole board rather than about
     * any one widget, such as the flight on screen being something other than
     * it looks.
     *
     * The host draws each entry with its own `Badge`, in registration order,
     * inside a polite live region, so a badge appearing is announced. A
     * contribution that declares `requires` shows only while its Domain is
     * present, so a bundled client whose mod is not running adds nothing.
     */
    "app.header-badges": {
      entry: BadgeEntry;
    };
  }
}
