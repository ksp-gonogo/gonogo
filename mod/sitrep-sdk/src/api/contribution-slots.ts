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
// `ShipMapPartMeterEntry` no longer carries a `tone` (design doc:
// local_docs/design/2026-08-08-resource-colour-system.md, gonogo main
// repo): the meter's fill is the resource's IDENTITY colour, derived by the
// renderer from `resource` via ui-kit's `resourceColor`, never chosen by a
// contributor. `status` is the SEPARATE, level-driven signal (a border tint
// or badge) that `tone` used to conflate with the fill hue. `ShipMapMeterTone`
// stays exported for `ShipMapPartMetaEntry`, which is a different kind of
// row (process running/broken, habitat pressure, ...) and is unaffected by
// this change: its `tone` genuinely IS a status colour, not an identity.
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

/** Mirrors `SystemEntityOrbitPosition`. */
export interface SystemEntityOrbitPosition {
  kind: "orbit";
  parentName: string;
  sma: number;
  ecc: number;
  lan: number;
  argPe: number;
  trueAnomaly: number;
}

/** Mirrors `SystemEntityFixedPosition`. */
export interface SystemEntityFixedPosition {
  kind: "fixed";
  parentName: string;
  xMetres: number;
  yMetres: number;
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
  }
}
