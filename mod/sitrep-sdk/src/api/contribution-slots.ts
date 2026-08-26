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
// The first two first-party contribution slots landed here (spec §13.4, the
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

declare module "./types" {
  interface ContributionRegistry {
    "ship-map.part-meters": {
      entry: ShipMapPartMeterEntry;
      topics: "vessel.parts" | "kerbalism.profile";
    };
    "ship-map.part-meta": {
      entry: ShipMapPartMetaEntry;
      topics: "kerbalism.lifesupport" | "kerbalism.profile";
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
      topics: "realantennas.hopRates";
    };
  }
}
