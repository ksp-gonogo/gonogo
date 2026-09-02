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
// would conflate it with the fill hue. `ShipMapMeterTone` IS exported, for
// `ShipMapPartMetaEntry`: that is a different kind of row (process
// running/broken, habitat pressure, ...) whose `tone` genuinely is a status
// colour rather than an identity.
// ---------------------------------------------------------------------------

import type { StatEntry } from "./types";

/** Mirrors ui-kit's `MeterTone` (`packages/ui-kit/src/Meter.tsx`). */
export type ShipMapMeterTone = "neutral" | "go" | "warn" | "nogo" | "info";

/** Mirrors `ShipMapPartMeterEntry` (`ShipMap/shipTopology.ts`). */
export interface ShipMapPartMeterEntry {
  partId: string;
  resource: string;
  displayName: string;
  amount: number;
  capacity: number;
  status?: "low" | "critical" | null;
}

/** Mirrors `ShipMapPartMetaEntry` (`ShipMap/shipTopology.ts`). */
export interface ShipMapPartMetaEntry {
  partId: string;
  label: string;
  tone: ShipMapMeterTone;
  kind: "ratio" | "text";
  value?: number;
  text?: string;
}

/**
 * One `comm-signal.hop-rates` entry: a single hop's forward band rate, keyed by
 * the SAME node ids `comms.path` carries (`fromNodeId`/`toNodeId`), so
 * CommSignal's route schedule can join a rate onto the hop it already renders
 * WITHOUT importing any backend-aware code or naming a provider. The join key is
 * derived once, in `CommSignal/commsRoute.ts`; a contributor relays the node ids
 * verbatim off its own Topic. `bitsPerSec` is a plain magnitude (bits/sec); the
 * schedule wraps it in `<Unit>` for display and compares magnitudes to flag the
 * bottleneck (minimum-rate) hop. Owned by `packages/components/src/CommSignal`;
 * the built-in RealAntennas contribution fills it off `realantennas.hopRates`.
 */
export interface CommSignalHopRateEntry {
  fromNodeId: string;
  toNodeId: string;
  bitsPerSec: number;
}

// SystemView (packages/components/src/SystemView)
//
// `system-view.entities` (the shape-contribution foundation: vessel orbits,
// the CommNet graph, selection, a future CME front all ride this one slot).
// Mirrors `SystemEntity` and its position/shape unions from
// `SystemView/systemEntities.ts`.

export type SystemEntityEmphasis = "faint" | "normal" | "bright";

/** Mirrors `SystemEntitySeverity`. */
export type SystemEntitySeverity = "info" | "warning" | "critical";

/** Mirrors `SystemEntityStyle`. A contribution names `emphasis` and
 *  `severity`; `colour` is the host's own decoration channel. */
export interface SystemEntityStyle {
  emphasis?: SystemEntityEmphasis;
  severity?: SystemEntitySeverity;
  colour?: string;
}

/** Mirrors `SystemEntityMeta`. */
export type SystemEntityMeta = Readonly<
  Record<string, string | number | boolean>
>;

/** Mirrors `SystemEntityOrbitPosition`. Both `inclination` and the fixed
 *  position's `zMetres` are REQUIRED: SystemView's arithmetic is
 *  three-dimensional and the frame it draws in is a rotation about an arbitrary
 *  axis, so a two-component position is not a position it can turn. An orbit
 *  that really is equatorial says `0`. */
export interface SystemEntityOrbitPosition {
  kind: "orbit";
  parentName: string;
  sma: number;
  ecc: number;
  lan: number;
  argPe: number;
  /** Inclination to the parent's reference plane, degrees. */
  inclination: number;
  trueAnomaly: number;
}

/** Mirrors `SystemEntityFixedPosition`. */
export interface SystemEntityFixedPosition {
  kind: "fixed";
  parentName: string;
  xMetres: number;
  yMetres: number;
  /** Out of the parent's reference plane, metres. */
  zMetres: number;
}

/** Mirrors `SystemEntityPosition`. */
export type SystemEntityPosition =
  | SystemEntityOrbitPosition
  | SystemEntityFixedPosition;

/** Mirrors `SystemEntityShape`. */
export type SystemEntityShape =
  | { kind: "point"; radiusPx?: number }
  | { kind: "orbit-path" }
  | { kind: "connection-line"; to: SystemEntityPosition }
  | { kind: "blob"; radiusMetres: number }
  | {
      kind: "travelling-pulse";
      to: SystemEntityPosition;
      segmentLengthMetres: number;
      /** UT the leading edge reaches `to`. */
      arriveUt: number;
      /** UT the trailing edge fully clears `to`. */
      clearUt: number;
    };

/** Mirrors `SystemEntity`. */
export interface SystemEntity {
  id: string;
  position: SystemEntityPosition;
  shape: SystemEntityShape;
  style?: SystemEntityStyle;
  meta?: SystemEntityMeta;
  vesselId?: string;
  zHint?: number;
}

// `crew-status.row-tone` (packages/components/src/CrewStatus): how alarming
// one kerbal's situation is. A contributor names the SEVERITY and nothing
// else; CrewStatus owns the palette and decides what its roster-row `Card`
// looks like, so this Uplink-facing type deliberately cannot say "alert" or
// name a colour. Same three words as `SystemEntitySeverity` above, on purpose:
// one severity vocabulary across every slot an Uplink can fill.

/** Mirrors `CrewRowToneEntry` (CrewStatus/index.tsx). Omit a kerbal entirely
 *  for "nothing to report" rather than contributing an `info` entry. */
export interface CrewRowToneEntry {
  /** The crew member this entry is about; matched to a roster row by name. */
  crewName: string;
  severity: SystemEntitySeverity;
}

// The plot SUBJECTS `packages/components` draws, declared so a contributor
// enriching one gets it as a completion and a typo fails to compile rather than
// quietly making a second plot. Same reasoning as the slot ids below, one
// registry per declaration-merge seam.
/**
 * One SCREEN the Administration Building offers, on `strategies.screens`.
 * Mirrors `StrategiesScreenEntry` (`Strategies/screens.ts`).
 *
 * <para>The widget draws a FACILITY, and which screens a facility owns is a
 * property of the elected career model rather than of the widget: RP-1's
 * building has Programs and Leaders where a stock one has neither. So the
 * contributor owns which screens exist, what each is called, where it sits and
 * what it lists, and the host owns the tab strip's behaviour, because no Uplink
 * should have to reimplement a tablist.</para>
 *
 * <para>There is deliberately no COUNT in this shape, and no way to express one.
 * A count cannot be ordered, cannot be labelled, and cannot be locked, and those
 * are the three things a screen has to be able to say about itself.</para>
 */
export interface StrategiesScreenEntry {
  /** Stable id, unique within the contributing client. */
  id: string;
  /** What the operator reads on the tab, e.g. RP-1's "Programs". */
  label: string;
  /**
   * Ascending, ties keeping contribution order; a screen without one sorts
   * after every screen that has one. Stated rather than derived, because the
   * order a career model wants its screens in is not on the wire: RP-1 declares
   * its departments in a config file and the file's order does not travel.
   */
  order?: number;
  /**
   * The strategy DEPARTMENTS this screen lists, matched against `department` on
   * each entry of `career.status`'s strategy list. The host draws its own
   * strategy cards for whatever matches, so a contributor never reimplements
   * one. A screen naming none lists nothing and is chrome for its augments.
   */
  departments?: readonly string[];
  /**
   * False for a screen that exists but cannot be opened yet.
   *
   * <para>The tab is still drawn AND still selectable, because `disabledReason`
   * is then the only thing on that screen worth reading and a tab that cannot be
   * reached cannot deliver it. This is the whole reason a screen is contributed
   * rather than inferred from whoever happens to have registered a body: an
   * unavailable screen that is simply ABSENT tells the operator nothing, and
   * absence is indistinguishable from a bundle that failed to load.</para>
   */
  enabled?: boolean;
  /** Why `enabled` is false, in the operator's own terms. */
  disabledReason?: string;
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
  /** The same three words every other contribution in the app uses. */
  severity?: "info" | "warning" | "critical";
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
 * One `experiments.instruments` entry: a science instrument aboard the active
 * vessel that Experiments cannot observe for itself.
 *
 * <para>The widget reads `science.instruments`, which is the STOCK experiment
 * list. A mod that runs its own experiment parts through its own science module
 * rather than the stock one never appears there, so without this slot those
 * instruments are invisible to the one widget whose whole subject is "what
 * science hardware is aboard".</para>
 *
 * <para>Already normalised, and deliberately so: plain booleans rather than the
 * wire's optionals, because a contributor has already parsed its own Topic and
 * the host must not have to guess what a missing flag meant. `partId` is a
 * string for the same reason it is one on the widget's own parsed shape: every
 * consumer interpolates it into a key and none compares it numerically.</para>
 *
 * <para>The four booleans are the instrument's LIFECYCLE, and a contributor
 * whose domain has no such lifecycle says so plainly rather than omitting them:
 * a survey scanner that can be neither deployed nor made inoperable says
 * `false` to both and `true` to `rerunnable`. There is no field for "this
 * instrument's state is unknown", because the host draws a badge per flag and a
 * third state would be a badge that means nothing.</para>
 *
 * <para>Contributed instruments render READ-ONLY. The host's Deploy and
 * Transmit controls dispatch `science.experiment.deploy`/`.transmit`, which
 * reach a part through the stock science module; a part the stock list never
 * mentioned is not one those commands can act on, so the host renders no
 * control rather than one that would arm and do nothing. A contributor wanting
 * commands of its own has `experiments.instrument`, the per-instrument AUGMENT
 * slot, which is a different mechanism for a different job: an augment renders,
 * a contribution supplies.</para>
 *
 * Mirrors `ExperimentsInstrumentEntry` (`packages/components/src/Experiments/index.tsx`).
 */
export interface ExperimentsInstrumentEntry {
  /** Stable within the contributing client; the row's React key. */
  partId: string;
  /** What the operator reads on the row, e.g. "2HOT Thermometer". */
  partTitle: string;
  /** KSP experiment id, e.g. `"temperatureScan"`. Groups the rows. */
  expId: string;
  deployed: boolean;
  /** The instrument currently holds collectable data. */
  hasData: boolean;
  rerunnable: boolean;
  inoperable: boolean;
}

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
     * A slot declares the CORE topics every contributor can rely on, and no
     * more. It never names a mod's topics.
     *
     * These unions used to list them: part-meters named `kerbalism.profile`,
     * part-meta named only Kerbalism topics, hop-rates named only
     * `realantennas.hopRates`. That put mod-owned ids in the PUBLISHED SDK and
     * told an outside author that to fill part-meta they may read Kerbalism and
     * nothing else, which is the opposite of what a slot is for.
     *
     * It was also redundant. A contribution declares its own `deps` at runtime,
     * and that is what actually feeds `compute`. The union only typed the
     * argument, `ContributionTopics` keeps an `& Record<string, unknown>` tail
     * so an undeclared topic is still readable, and the one contributor each
     * mod-topic was written for casts through it anyway. Nothing consumed the
     * precision it existed to provide.
     *
     * A slot whose contributors bring their own data declares no `topics` at
     * all, which resolves to `never` and leaves `compute` the open record. That
     * is the honest statement: the slot does not care who fills it.
     */
    "ship-map.part-meters": {
      entry: ShipMapPartMeterEntry;
      topics: "vessel.parts";
    };
    "ship-map.part-meta": {
      entry: ShipMapPartMetaEntry;
    };
    "system-view.entities": {
      entry: SystemEntity;
      topics: "system.vessels" | "system.bodies" | "comms.network";
    };
    "crew-status.row-tone": {
      entry: CrewRowToneEntry;
      topics: "vessel.crew";
    };
    "comm-signal.hop-rates": {
      entry: CommSignalHopRateEntry;
    };
    "strategies.screens": {
      entry: StrategiesScreenEntry;
      topics: "career.status";
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
     * how many qualifications are about to lapse. It declares the crew roster as
     * the topic every contributor can rely on, and nothing of any mod's.
     */
    "astronaut-complex.readouts": {
      entry: StatEntry;
      topics: "spaceCenter.crewRoster";
    };
  }
}
