// ---------------------------------------------------------------------------
// Author-facing type surface: PROPOSAL, pending operator sign-off (design D-D)
// before the first external Uplink is published. Nothing here is a frozen
// contract yet; the api-shape gate records the CURRENT proposed surface so any
// change is a conscious one.
//
// Why these types live HERE and are not re-exported from `@ksp-gonogo/core`:
// sitrep-sdk is the dependency-graph LEAF (core → sitrep-client → sitrep-sdk).
// Importing core (even `import type` via a package dependency) would form a
// turbo `^build` cycle, so the leaf cannot name a workspace package. The
// author-facing shapes are therefore mirrored here, self-contained, and kept
// honest by a conformance gate that lives in `core` (which already devDepends
// on this package): `packages/core/src/sdk-facade.conformance.test-d.ts` fails
// typecheck if core's real types drift out of structural compatibility with
// these. When the loader work inverts the type source into this leaf, the
// mirror is replaced by the real declarations and the conformance gate retires.
// ---------------------------------------------------------------------------

import type { ComponentType } from "react";
import type { TopicId, TopicPayload } from "../topics";

/** A dashboard component's declared data dependency, e.g. `"vessel.altitude"`. */
export type DataRequirement = string;

/** Behaviours a component can opt into; `gonogo-participant` joins GO/NO-GO. */
export type ComponentBehavior = "gonogo-participant";

/** Game-state preconditions the orchestrator dims a widget when unmet. */
export type ComponentRequirement = "flight" | "career";

// --- Serial input actions ---------------------------------------------------

export type ActionInputKind = "button" | "analog";

export interface ActionInputPayload {
  kind: ActionInputKind;
  /** Button: true=pressed, false=released. Analog: normalised to -1..1. */
  value: boolean | number;
  /** Device-specific raw value before normalisation, if the handler wants it. */
  raw?: unknown;
}

export interface ActionDefinition {
  /** Stable ID used when persisting an input→action mapping. Unique per component. */
  id: string;
  label: string;
  /** Which input kinds may drive this action. */
  accepts: readonly ActionInputKind[];
  description?: string;
}

/** Typed handler map for {@link useActionInput}, keyed by each action's `id`. */
export type ActionHandlers<TActions extends readonly ActionDefinition[]> = {
  [K in TActions[number]["id"]]: (payload: ActionInputPayload) => unknown;
};

// --- Component registration -------------------------------------------------

/** Props passed to every registered dashboard component. */
export interface ComponentProps<TConfig = Record<string, unknown>> {
  config?: TConfig;
  id: string;
  w?: number;
  h?: number;
  onConfigChange?: (config: TConfig) => void;
}

/** Props passed to a component's config UI (rendered inside a modal). */
export interface ConfigComponentProps<TConfig = Record<string, unknown>> {
  config: TConfig;
  onSave: (config: TConfig) => void;
}

/** Registration descriptor for a dashboard component. */
export interface ComponentDefinition<TConfig = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  /** Free-form tags; UI may style known values (e.g. 'telemetry', 'control'). */
  tags: string[];
  component: ComponentType<ComponentProps<TConfig>>;
  /** Config UI rendered inside a modal; shown via the gear icon. */
  configComponent?: ComponentType<ConfigComponentProps<TConfig>>;
  openConfigOnAdd?: boolean;
  defaultSize?: { w: number; h: number };
  minSize?: { w: number; h: number };
  mobileWidth?: "full" | "half";
  mobileHeight?: number;
  dataRequirements?: DataRequirement[];
  /** Topics this widget REQUIRES; read non-null through the manifest hook. */
  channels?: readonly TopicId[];
  /** Topics this widget OPTIONALLY consumes: each read is `| undefined`. */
  optionalChannels?: readonly TopicId[];
  behaviors?: ComponentBehavior[];
  defaultConfig?: Partial<TConfig>;
  /** Actions this component exposes to the serial input platform. */
  actions?: readonly ActionDefinition[];
  pushable?: boolean;
  /** Game-state preconditions for this widget to be "live". */
  requires?: readonly ComponentRequirement[];
  /** Addressable augment slots this widget owns. */
  augmentSlots?: string[];
  /** Declares this widget REPLACES the widget with the given id. */
  replaces?: string;
  /**
   * The Uplink client that registered this widget, stamped via
   * `defineUplinkClient`'s returned handle: see `UplinkClientHandle`'s own
   * doc below. Provenance / mod search tags only; never hand-set.
   */
  owner?: UplinkClientHandle;
}

// --- Themes -----------------------------------------------------------------

/**
 * Theme registration descriptor. `theme` is the design-system token object
 * (a `GonogoTheme` from `@ksp-gonogo/ui-kit`). Typed loosely here because the
 * concrete token shape ships from the separately-published ui-kit package, not
 * this leaf; an author composing ui-kit gets the precise type from there.
 */
export interface ThemeDefinition {
  id: string;
  name: string;
  theme: unknown;
}

// --- Augments (slot composition) --------------------------------------------

/**
 * Declaration-merging seam for slot props. An augmenting package merges a slot
 * id → props type; a slot not (yet) in the registry falls back to a loose bag.
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging seam
export interface SlotRegistry {}

export type SlotId = keyof SlotRegistry;

export type SlotProps<S extends string> = S extends keyof SlotRegistry
  ? SlotRegistry[S]
  : Record<string, unknown>;

// --- Contributions (pure-data slot composition) ------------------------------

/**
 * Declaration-merging seam for the contribution model (contribution-slots-
 * spec §3-4), mirrors `SlotRegistry` above: an augmenting package (in
 * practice today, `mod/sitrep-sdk/src/api/contribution-slots.ts`) merges a
 * contribution slot id into this interface. Empty until the first
 * first-party contribution slot lands (Application phase, a separate
 * follow-up plan); this base declaration is what lets that satellite file's
 * `declare module "./types"` block be recognised as an AUGMENTATION of an
 * existing export rather than a fresh ambient module declaration (which TS
 * rejects for a relative specifier).
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging seam
export interface ContributionRegistry {}

/**
 * The entry type a `ContributionRegistry` slot's contributions render,
 * mirroring `packages/core/src/contributions.ts`'s own `ContributionEntry<S>`
 * (same name, same extraction: `ContributionRegistry[S] extends { entry:
 * infer E } ? E : ...`), same leaf constraint as `SlotProps<S>` above. An
 * Uplink contribution built against `ContributionEntry<"ship-map.part-
 * meters">` gets the real, host-declared entry shape once
 * `./contribution-slots.ts` mirrors that slot; a slot not yet declared here
 * falls back to the loose bag, matching `SlotProps`'s own fallback.
 */
export type ContributionEntry<S extends string> =
  S extends keyof ContributionRegistry
    ? ContributionRegistry[S] extends { entry: infer E }
      ? E
      : Record<string, unknown>
    : Record<string, unknown>;

/**
 * Whether a filter group's options combine or replace each other. Declared by
 * the CONTRIBUTOR, because it is a statement about what the facets mean, never
 * inferred by the host from how many options happen to be present: the same
 * axis must not change behaviour between a three-resource vessel and a
 * twelve-resource one.
 *
 * - `multi` (the default): independent facets, OR'd together. Selecting two
 *   shows items matching either
 * - `single`: mutually exclusive facets, one at a time. Selecting one replaces
 *   the previous selection
 *
 * The host picks the CONTROL (chips, a dropdown, a listbox) and may vary it
 * with option count, but it must honour the semantics: a `multi` group is never
 * rendered as a control that can only hold one selection.
 */
export type FilterSelection = "single" | "multi";

/**
 * One named, contributed filter over a host widget's list: the layer-1
 * contributable-filters mechanism (contribution-slots-spec §15).
 *
 * The point is that the HOST never learns the taxonomy. A widget with a
 * filterable list declares a `<widget-id>.filters` contribution slot whose
 * entry is a `FilterEntry` over its own row type; whoever legitimately knows
 * how those rows divide up (the app itself, or the Uplink whose mod produced
 * them) contributes named predicates, and the widget renders whatever arrived
 * as toggles without knowing what any of it means.
 *
 * The honesty rule this exists to serve: a filter must MEAN what its label
 * implies. Contributing a filter gonogo's data cannot honestly support (an
 * ISRU-versus-life-support split, on a backend that draws no such line) is
 * exactly what the mechanism replaces, so the answer is that the provider
 * contributes its OWN axis instead, not that the host invents one.
 *
 * `T` is the host's row type; predicates run against it directly.
 */
export interface FilterEntry<T> {
  /** Stable id, unique within the contribution that emitted it. */
  id: string;
  /** Operator-facing label for this facet. The provider's own vocabulary. */
  label: string;
  /**
   * Groups facets that share an axis (all the resource facets, all the process
   * facets). Omit for a standalone filter, which becomes its own group of one.
   * Two contributions may deliberately feed the SAME group id, in which case
   * their facets sit side by side on one axis.
   */
  group?: string;
  /** Operator-facing label for the group, e.g. "Resource". Falls back to none. */
  groupLabel?: string;
  /**
   * This group's selection semantics; see {@link FilterSelection}. Declared on
   * the entry rather than a separate group record because the runtime carries
   * one flat entry array per slot. The first entry of a group to declare it
   * wins, so a group fed by two contributions keeps the semantics its first
   * contributor stated.
   */
  selection?: FilterSelection;
  /**
   * True to KEEP the item. Pure, and evaluated for every row on every render,
   * so keep it cheap. It may close over anything the contribution's `compute`
   * read from its declared deps, which is how a filter gets at live Topic data
   * without the host plumbing any through.
   */
  predicate: (item: T) => boolean;
}

export interface AugmentSettingField {
  key: string;
  type: "boolean" | "text" | "number";
  label?: string;
  default?: boolean | string | number;
}

/** Registration descriptor for an augment bound into another widget's slot. */
export interface AugmentDefinition<S extends string = string> {
  id: string;
  augments: S;
  component: ComponentType<SlotProps<S>>;
  channels?: readonly TopicId[];
  requires?: string;
  priority?: number;
  settings?: readonly AugmentSettingField[];
  /** Declares that, while this augment is registered, the host's own
   *  default/replaceable surface for its slot is suppressed outright; see
   *  the real `AugmentDefinition` (packages/core/src/augments.ts) for the
   *  full rationale. */
  suppressesVanillaBase?: boolean;
  /**
   * The Uplink client that registered this augment, stamped via
   * `defineUplinkClient`'s returned handle. Provenance only; never hand-set.
   */
  owner?: UplinkClientHandle;
}

// --- Uplink client identity (Uplink Client Contract design §3.1) -----------

/**
 * Mirrors `packages/core/src/uplinkClients.ts`'s `UplinkClientHandle`: same
 * leaf constraint as every other type in this file. One declaration per
 * client bundle (`defineUplinkClient`); widgets/augments stamp it as `owner`.
 */
export interface UplinkClientHandle {
  /** MUST match the mod's `[SitrepUplink("<id>")]` id and its gonogo-uplink.json id. */
  id: string;
  /** The Uplink's one version line (mod + client). */
  version: string;
  /** Human label for management/health surfaces. */
  name: string;
  /**
   * Register a contribution auto-namespaced to this client: `def.id` is
   * stamped `${this.id}:${def.id}` before it reaches the contribution
   * registry, so two Uplinks can never collide on a local id. Mirrors
   * `packages/core/src/uplinkClients.ts`'s bound method; the contribution
   * primitive itself (`ContributionDefinition` et al., core's
   * `packages/core/src/contributions.ts`) is not yet part of the frozen
   * author-facing surface, so its shape is inlined here rather than named.
   */
  registerContribution<S extends string>(def: {
    id: string;
    contributes: S;
    /** A Topic id OR a Processor handle (the branded shape `registerProcessor`
     *  returns), mirroring core's `Dep`. The processor-handle case is the same
     *  structural mirror used above, since the leaf cannot name
     *  sitrep-client's `ProcessorHandle`. */
    deps?: readonly (
      | TopicId
      | { readonly id: string; readonly __resultType?: unknown }
    )[];
    /** Intentionally loose: this mirror is a name+arity probe (see file
     *  header); the real signature's `topics`/return shapes are derived from
     *  `ContributionRegistry` declaration merging, which this leaf cannot see. */
    // biome-ignore lint/suspicious/noExplicitAny: see comment above
    compute: (topics: any) => readonly any[] | null | undefined;
    requires?: string;
    priority?: number;
    settings?: readonly AugmentSettingField[];
  }): void;
  /**
   * Register a Processor auto-namespaced to this client (mirrors
   * `registerContribution`'s owner-stamping). Same leaf constraint as the rest
   * of this file: the shared derived-logic primitive (`ProcessorHandle`, `Dep`,
   * `ResolvedDeps`, sitrep-client's `processors.ts`) is not part of the frozen
   * author-facing surface, so its shape is inlined loosely here (a name+arity
   * probe, like `registerContribution`) rather than named.
   */
  registerProcessor<
    const Deps extends readonly (
      | TopicId
      | { readonly id: string; readonly __resultType?: unknown }
    )[],
    R,
  >(def: {
    id: string;
    deps: Deps;
    /** Intentionally loose: the leaf cannot name `ResolvedDeps<Deps>`. */
    // biome-ignore lint/suspicious/noExplicitAny: name+arity probe (see above)
    compute: (values: any) => R;
  }): { readonly id: string; readonly __resultType?: R };
}

// --- Fog reveal sources ------------------------------------------------------

/**
 * Registration descriptor for a fog-of-war reveal source, a data
 * contributor (coverage bytes for a body under some layerId), not a
 * renderable component. See packages/core/src/fogReveal.ts's own header
 * for why this isn't another AugmentSlot kind.
 */
export interface FogRevealSourceDefinition {
  id: string;
  label?: string;
  weight?: number;
  settings?: readonly AugmentSettingField[];
}

// --- Map POI providers -------------------------------------------------------

/**
 * One point-of-interest record a `MapPoiProviderDefinition` contributes.
 * Mirrors `packages/core/src/mapPoi.ts`'s `MapPoi`: same leaf constraint as
 * every other type in this file (see module header). The action-button
 * shape (`MapPoiAction` in core) is inlined here rather than named
 * separately: nothing in the author-facing surface needs to reference it by
 * name on its own.
 */
export interface MapPoi {
  /** Unique within the OWNING PROVIDER's namespace. */
  id: string;
  /** Body NAME, matches MapView's own bodyName convention. */
  bodyId: string;
  lat: number;
  lon: number;
  /** Open string, not a closed union: third-party kinds fall back to a generic style. */
  kind: string;
  label: string;
  detail?: string;
  status?: "active" | "available" | "info";
  meta?: Record<string, unknown>;
  actions?: readonly {
    id: string;
    label: string;
    run: () => void | Promise<void>;
    disabled?: boolean;
    disabledReason?: string;
  }[];
}

/**
 * Registration descriptor for a map point-of-interest provider, a data
 * contributor (points for the currently-mapped body), not a renderable
 * component. See packages/core/src/mapPoi.ts's own header for why MapView
 * owns the one shared hover/action/marker-styling surface instead of this
 * being another AugmentSlot kind.
 */
export interface MapPoiProviderDefinition {
  /** "<uplinkId>:<name>", e.g. "vanilla:spaceCenter", "example-uplink:anomalies". */
  id: string;
  /** Domain presence gate, same semantics as AugmentDefinition.requires. */
  requires?: string;
  usePois: (ctx: { bodyId: string | undefined }) => unknown;
}

// --- Celestial bodies ---------------------------------------------------------

/**
 * Mirrors `packages/core/src/bodies.ts`'s `BodyDefinition`: same leaf
 * constraint as every other type in this file. Note the body REGISTRY
 * itself (`getBody`, below) is still a host shim, not a bundled copy: it is
 * a module-global map populated at runtime via `registerBody()`, so a
 * facade-sealed client bundling its own `getBody` would read its own,
 * permanently-empty copy of that map rather than the app's real one.
 */
export interface BodyDefinition {
  /** Unique identifier: must match Telemachus v.body / o.referenceBody strings. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Mean radius in metres. */
  radius: number;
  /** Standard gravitational parameter (GM) in m³/s². */
  gm?: number;
  /** Path or URL to a surface texture image (equirectangular projection). */
  texture?: string;
  /** Fallback display colour (CSS colour string) used when no texture is available. */
  color?: string;
  /** Longitude correction in degrees added to Telemachus v.long before mapping. */
  longitudeOffset?: number;
  /** Latitude correction in degrees added to Telemachus v.lat before mapping. */
  latitudeOffset?: number;
  /** ID of the parent body (e.g. "Kerbin" for "Mun"). Absent for the star. */
  parent?: string;
  /** Radius of the sphere of influence in metres (KSP `a·(m/M)^0.4`). */
  soi?: number;
  /** Texture map metadata, required for accurate lat/lon → pixel mapping. */
  map?: {
    type: "equirectangular";
    /** Pixel width of the source texture image. */
    width: number;
    /** Pixel height of the source texture image. */
    height: number;
  };
  /** If the body has an atmosphere */
  hasAtmosphere: boolean;
  /** The height above sea level where the atmosphere is stopped */
  maxAtmosphere: number;
  /** Optional atmosphere model. Only meaningful when `hasAtmosphere` is true. */
  atmosphere?: {
    /** Surface pressure in pascals. */
    surfacePressure: number;
    /** Scale height (e-folding altitude) in metres. */
    scaleHeight: number;
  };
  /** Sidereal rotation period in seconds. */
  rotationPeriod?: number;
  /** Minimum altitude (metres ASL) at which satellite imaging produces usable data. */
  imagingMinAlt?: number;
  /** Ideal imaging altitude (metres ASL). Quality reaches 1 here. */
  imagingIdealAlt?: number;
  /** Maximum imaging altitude (metres ASL). Above this, quality is zero. */
  imagingMaxAlt?: number;
  /** Camera half-angle (degrees): the cone half-angle used when projecting the imaging footprint. */
  cameraFovDeg?: number;
  /** Optional circular region revealed from the start. */
  initialReveal?: {
    lat: number;
    lon: number;
    /** Disc radius in metres (surface-measured, not angular). */
    radiusMetres: number;
  };
}

// --- Fog mask cache ------------------------------------------------------------
//
// Same leaf constraint again: `BodyMask` is owned by `@ksp-gonogo/data`
// (packages/data/src/fog/FogMaskCache.ts), which the sdk cannot depend on
// either (data itself depends on core, which depends on the sdk, naming
// data here would form the same turbo `^build` cycle). Mirrored here.

export interface BodyMask {
  readonly bodyId: string;
  readonly layerId: string;
  readonly width: number;
  readonly height: number;
  /** Alpha bytes, row-major. Mutable: caller writes directly. */
  data: Uint8Array;
}

/**
 * The subset of `FogMaskCache`'s (`@ksp-gonogo/data`) public surface an
 * author drives from `useFogMaskCache()`. Not itself part of the barrel's
 * named export list: every call site so far only ever holds this through
 * the hook's inferred return type (`const cache = useFogMaskCache();`),
 * never by importing the type name directly, so there is nothing to add to
 * the export list for it.
 */
export interface FogMaskCacheHandle {
  acquire(bodyId: string, layerId: string): Promise<BodyMask>;
  get(bodyId: string, layerId: string): BodyMask | undefined;
  markDirty(bodyId: string, layerId: string): void;
  onChange(
    bodyId: string,
    layerId: string,
    listener: (mask: BodyMask) => void,
  ): () => void;
  flush(): Promise<void>;
  clear(bodyId: string, layerId: string): Promise<void>;
  dispose(): Promise<void>;
}

// --- DataSource type mirror ---------------------------------------------------
//
// core owns `DataSource`/`DataSourceStatus`/`ConfigField`/`DataKey`
// (packages/core/src/types.ts) but the sdk cannot name it as a workspace
// dependency, so the shape is mirrored here and kept honest by
// `packages/core/src/sdk-facade.conformance.test-d.ts`.
//
// The `registerDataSource`/`getDataSource` author SPI that used to sit on
// `GonogoHost` and be typed against this mirror was removed for good on
// 2026-07-19 (facade-sealing plan §2.1): it went through a removal (2026-07-18,
// "zero production consumers"), a reversal the same night once two
// facade-sealed Uplink clients turned out to still need it, and this final
// removal once both were migrated onto their own non-SPI substitutes
// (a singleton-handle registration; a lifecycle-managed telemetry
// subscribe). The type mirror itself stays: an Uplink that carries its
// own connection-status field can still type it against
// `DataSourceStatus` without registering through the facade at all.

export type DataSourceStatus =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

export interface DataKey {
  key: string;
  description?: string;
}

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "number";
  placeholder?: string;
}

/**
 * Base interface for all data sources: mirrors core's real `DataSource`
 * shape (see the module-level comment above) for typing an Uplink's own
 * `status: DataSourceStatus` connection field.
 */
export interface DataSource<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  name: string;
  connect(): Promise<void>;
  disconnect(): void;
  status: DataSourceStatus;
  schema(): DataKey[];
  subscribe(key: string, cb: (value: unknown) => void): () => void;
  onStatusChange(cb: (status: DataSourceStatus) => void): () => void;
  execute(action: string): Promise<void>;
  configSchema(): ConfigField[];
  configure(config: Record<string, unknown>): void;
  getConfig(): TConfig;
  setupInstructions?(): string | null;
  affectedBySignalLoss?: boolean;
}

// --- Screen identity -----------------------------------------------------------
//
// Mirrors `@ksp-gonogo/core`'s `contexts/ScreenContext.tsx`: same leaf
// constraint as the rest of this file.

/**
 * Which screen a component is mounted on. The same registered component
 * can render different UIs on main vs station when it participates in a
 * multi-role interaction (e.g. GO/NO-GO voting).
 */
export type Screen = "main" | "station";

// --- Settings tabs ---------------------------------------------------------

/**
 * Mirrors `packages/core/src/settingsTabs.ts`'s `SettingsTabDefinition`:
 * same leaf constraint. An Uplink co-locates a whole Settings-modal tab's
 * registration with the code that owns it.
 */
export interface SettingsTabDefinition {
  /** Stable id: React key and tab id. */
  id: string;
  /** Tab label shown in the Settings modal's tab strip. */
  label: string;
  /** The tab's content, rendered with no props. */
  component: ComponentType;
  /** Which screens this tab appears on. Omit for both. */
  screens?: readonly Screen[];
}

// --- Declarative settings ---------------------------------------------------

/**
 * Mirrors `packages/core/src/settings/registry.ts`'s `SettingDefinition`: same
 * leaf constraint (the sdk cannot import core). `registerSetting` is the
 * PREFERRED way an Uplink surfaces a setting: a declarative row the app renders
 * and (for client-pref) persists, without a bespoke tab. Reach for
 * `registerSettingsTab` only when a setting's UI genuinely can't be a row.
 */
export type SettingType = "boolean";

export interface SettingDefinitionBase {
  id: string;
  label: string;
  description?: string;
  category: string;
  /** Which screens this setting is relevant on. Omit for both. */
  screens?: readonly Screen[];
  /** Id of a parent boolean setting this one nests under (rendering hint). */
  dependsOn?: string;
}

/** localStorage-backed preference: pure gonogo-side, no mod round-trip. */
export interface ClientPrefSetting extends SettingDefinitionBase {
  backing?: "client-pref";
  type: "boolean";
  defaultValue: boolean;
}

/**
 * Source-backed setting: value lives on the Uplink's `DataSource` (by
 * `sourceId`), read/written through the client-supplied binding closures, never
 * localStorage. The registry stores them type-erased (`source: unknown`); the
 * client casts to the concrete source type it owns.
 */
export interface SourceBackedSetting extends SettingDefinitionBase {
  backing: "source-backed";
  type: "boolean";
  sourceId: string;
  read: (source: unknown) => boolean;
  write: (source: unknown, value: boolean) => void;
  subscribe: (source: unknown, cb: () => void) => () => void;
}

export type SettingDefinition = ClientPrefSetting | SourceBackedSetting;

// --- Telemetry client (sitrep-client) SPI ------------------------------------
//
// Same leaf constraint as `StreamStatusValue` below: `TelemetryClient` is
// owned by `@ksp-gonogo/sitrep-client`, which the sdk cannot depend on
// either. Mirrors only the surface an Uplink author drives directly
// (subscribe/dispatch/getValue/dispose): NOT the full class
// (`onRawMessage`'s raw-frame tap, `attachStore`/`subscribeStore`'s
// `TimelineStore` plumbing, `getCommand`'s `CommandStatus`), which stay
// opaque for the same "large, evolving class" reasoning that keeps
// `useTelemetryStoreOptional` returning `unknown` rather than a mirrored
// `TimelineStore`.

export interface TelemetryClient {
  subscribe(topic: string, cb: (value: unknown) => void): () => void;
  getValue(topic: string): unknown;
  dispatch(
    command: string,
    args?: unknown,
    label?: string,
    topic?: string,
  ): { requestId: string; result: Promise<unknown> };
  dispose(): void;
}

// --- Media delay clock SPI (sitrep-client) -----------------------------------
//
// Same leaf constraint as `TelemetryClient` above: `DelayClockLike` is owned
// by `@ksp-gonogo/sitrep-client` (packages/sitrep-client/src/media/
// delayed-playout-buffer.ts), which the sdk cannot depend on either. Mirrors
// the minimal two-method structural contract a camera Uplink's delayed-media
// pipeline needs off the one delay authority (`ViewClock` satisfies this
// structurally): kept honest by
// `packages/core/src/sdk-facade.conformance.test-d.ts`.

/**
 * The minimal delay-clock surface a media delay pipeline depends on, a
 * subset of `ViewClock`'s `ViewClockView` (`confirmedEdgeUt` + `onFrame`).
 * Kept structural (not `ViewClock` itself) so a camera Uplink never needs to
 * import sitrep-client just to type the clock it's handed.
 */
export interface DelayClockLike {
  /** The certainty horizon: a frame stamped at-or-before this UT is
   *  releasable. THE one delay authority: never delay-subtracted here. */
  confirmedEdgeUt(): number;
  /** Best-effort per-frame notification (real-time driven). Not required
   *  for correctness: a deterministic caller can drive releases some other
   *  way instead. */
  onFrame(cb: (viewUt: number) => void): () => void;
}

// --- Performance budgets ----------------------------------------------------

export interface PerfBudgetOptions {
  name: string;
  windowMs?: number;
  threshold: number;
  unit?: string;
}

/** The subset of `PerfBudget` an author touches after construction. */
export interface PerfBudgetHandle {
  record(amount?: number, now?: number): void;
}

// --- Hook result shapes -----------------------------------------------------
//
// Same leaf constraint again: `CommandStatus` is owned by
// `@ksp-gonogo/sitrep-client` (packages/sitrep-client/src/lifecycle.ts),
// which the sdk cannot name as a workspace dependency either. Mirrored here
// verbatim; kept honest by `packages/core/src/sdk-facade.conformance.test-d.ts`.

/**
 * Lifecycle state for a single dispatched command, keyed by `requestId`.
 * Mirrors `packages/sitrep-client/src/lifecycle.ts`'s `CommandStatus`:
 * same leaf constraint as every other type in this file.
 */
export type CommandStatus =
  | { phase: "idle" }
  | { phase: "in-flight"; requestId: string; etaConfirm: number }
  | { phase: "confirmed"; requestId: string; result: unknown }
  | {
      phase: "failed";
      requestId: string;
      error: { code: string; message: string };
    }
  | { phase: "lost"; requestId: string; reason: string };

/**
 * Mirrors `packages/sitrep-client/src/command-delay.ts`'s `PredictedPhase`:
 * same leaf constraint as every other type in this file.
 */
export type PredictedPhase =
  | "in-transit"
  | "awaiting-reply"
  | "due"
  | "overdue"
  | "lost";

/**
 * Mirrors `packages/sitrep-client/src/command-delay.ts`'s `DelayMode`: same
 * leaf constraint as every other type in this file.
 */
export type DelayMode = "live" | "staged" | "no-path";

/**
 * Mirrors `packages/sitrep-client/src/command-delay.ts`'s `InFlightCommand`,
 * the shared display shape both `useCommand`'s `inFlight` and
 * `useRouteCommands`'s `items` return. Same leaf constraint as every other
 * type in this file.
 */
export interface InFlightCommand {
  id: string;
  label: string;
  command: string;
  topic: string;
  dispatchedAt: number;
  reachEtaSeconds: number | null;
  replyEtaSeconds: number | null;
  predictedPhase: PredictedPhase;
}

/**
 * Mirrors `packages/ui-kit/src/CommandDelay`'s `CommandOutputToken`, the
 * dev-only must-consume token `useCommand` hands out: `<CommandDelay>` flips
 * `consumed` on mount so a delayed command can't be dispatched without its
 * delay UX. Absent in production. Same leaf constraint as every other type.
 */
export interface CommandOutputToken {
  consumed: boolean;
}

export interface UseCommandResult {
  send: (
    args?: unknown,
    opts?: { label?: string; topic?: string },
  ) => Promise<unknown>;
  status: CommandStatus;
  inFlight: InFlightCommand[];
  /** Delay display this command uses; hand straight to `<CommandDelay>`. */
  shape: "discrete" | "stream";
  /** Effective one-way delay under this command's vantage (0 = instant). */
  effectiveDelaySeconds: number;
  /** Clear a dead (`overdue`/`lost`) command from `inFlight`; the manual out for
   *  a command that would otherwise sit forever. See sitrep-client's own doc. */
  dismiss: (id: string) => void;
  /** Dev-only must-consume token (absent in production). See `CommandOutputToken`. */
  _output?: CommandOutputToken;
}

/**
 * Mirrors `packages/sitrep-client/src/use-route-commands.ts`'s
 * `UseRouteCommandsResult`: same leaf constraint as every other type in
 * this file.
 */
export interface UseRouteCommandsResult {
  items: InFlightCommand[];
  mode: DelayMode;
}

// --- Stream SPI types ---------------------------------------------------------
//
// Same leaf constraint again: `StreamStatusValue` is owned by
// `@ksp-gonogo/sitrep-client` (packages/sitrep-client/src/stream-status.ts),
// which the sdk cannot name as a workspace dependency either (sitrep-client
// itself depends on the sdk for the wire contract, naming it back would form
// the same turbo `^build` cycle). Mirrored here; kept honest by the same
// conformance file in core, which already carries a real dependency on
// sitrep-client.

/** The staleness/absence status a topic (raw or derived) is in. */
export type StreamStatusValue =
  | "live"
  | "held-stale"
  | "disconnected"
  | "last-before-blackout"
  | "absent"
  | "resyncing";

// --- Late telemetry subscribe SPI (sitrep-client) ----------------------------
//
// Same leaf constraint as `TelemetryClient` above: `LateTelemetrySubscribe` is
// owned by `@ksp-gonogo/sitrep-client` (use-late-telemetry-subscribe.ts),
// which the sdk cannot depend on either. It builds on `TopicId`/
// `TopicPayload`, which ARE sdk-native, so the mirror is structurally
// identical, not a narrowed subset, kept honest by
// `packages/core/src/sdk-facade.conformance.test-d.ts`.
//
// The client's own `Unsubscribe = () => void` alias is NOT re-exported here
// under that name: the generated wire contract already exports an
// `Unsubscribe` interface (the `{ type: "unsubscribe"; topic: string }`
// client message), and this leaf's root barrel re-exports both the
// generated contract and this curated api barrel with `export *`, so a
// second top-level `Unsubscribe` would collide. `LateTelemetrySubscribe`'s
// return position is written out as `() => void` directly instead.

/**
 * The imperative subscribe function `useLateTelemetrySubscribe` returns: a
 * `TopicId` argument infers the payload type from `TopicPayloadMap` (the
 * same canonical typing `useTelemetry(topic)` gives a static topic); a
 * plain `string` argument (a runtime-templated topic, e.g. a per-body fog
 * mask) falls back to an explicit `T` type argument at the call site. Each
 * overload returns an unsubscribe function, safe to call more than once.
 */
export interface LateTelemetrySubscribe {
  <K extends TopicId>(
    topic: K,
    onValue: (value: TopicPayload<K>) => void,
  ): () => void;
  <T = unknown>(topic: string, onValue: (value: T) => void): () => void;
}
