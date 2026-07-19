// ---------------------------------------------------------------------------
// Author-facing type surface — PROPOSAL, pending operator sign-off (design D-D)
// before the first external Uplink is published. Nothing here is a frozen
// contract yet; the api-shape gate records the CURRENT proposed surface so any
// change is a conscious one.
//
// Why these types live HERE and are not re-exported from `@ksp-gonogo/core`:
// sitrep-sdk is the dependency-graph LEAF (core → sitrep-client → sitrep-sdk).
// Importing core — even `import type` via a package dependency — would form a
// turbo `^build` cycle, so the leaf cannot name a workspace package. The
// author-facing shapes are therefore mirrored here, self-contained, and kept
// honest by a conformance gate that lives in `core` (which already devDepends
// on this package): `packages/core/src/sdk-facade.conformance.test-d.ts` fails
// typecheck if core's real types drift out of structural compatibility with
// these. When the loader work inverts the type source into this leaf, the
// mirror is replaced by the real declarations and the conformance gate retires.
// ---------------------------------------------------------------------------

import type { ComponentType } from "react";
import type { TopicId } from "../topics";

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
  /** Topics this widget REQUIRES — read non-null through the manifest hook. */
  channels?: readonly TopicId[];
  /** Topics this widget OPTIONALLY consumes — each read is `| undefined`. */
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
}

// --- Fog reveal sources ------------------------------------------------------

/**
 * Registration descriptor for a fog-of-war reveal source — a data
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
 * Mirrors `packages/core/src/mapPoi.ts`'s `MapPoi` — same leaf constraint as
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
  /** Open string, not a closed union — third-party kinds fall back to a generic style. */
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
 * Registration descriptor for a map point-of-interest provider — a data
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
 * Mirrors `packages/core/src/bodies.ts`'s `BodyDefinition` — same leaf
 * constraint as every other type in this file. Note the body REGISTRY
 * itself (`getBody`, below) is still a host shim, not a bundled copy: it is
 * a module-global map populated at runtime via `registerBody()`, so a
 * facade-sealed client bundling its own `getBody` would read its own,
 * permanently-empty copy of that map rather than the app's real one.
 */
export interface BodyDefinition {
  /** Unique identifier — must match Telemachus v.body / o.referenceBody strings. */
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
  /** Camera half-angle (degrees) — the cone half-angle used when projecting the imaging footprint. */
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
// either (data itself depends on core, which depends on the sdk — naming
// data here would form the same turbo `^build` cycle). Mirrored here.

export interface BodyMask {
  readonly bodyId: string;
  readonly layerId: string;
  readonly width: number;
  readonly height: number;
  /** Alpha bytes, row-major. Mutable — caller writes directly. */
  data: Uint8Array;
}

/**
 * The subset of `FogMaskCache`'s (`@ksp-gonogo/data`) public surface an
 * author drives from `useFogMaskCache()`. Not itself part of the barrel's
 * named export list — every call site so far only ever holds this through
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

// --- DataSource-author SPI ---------------------------------------------------
//
// An Uplink that ships its OWN DataSource needs to TYPE its implementation
// against the real `DataSource` shape — same leaf constraint as above: core
// owns `DataSource`/`DataSourceStatus`/`ConfigField`/`DataKey`
// (packages/core/src/types.ts) but the sdk cannot name it as a workspace
// dependency, so the interface is mirrored here and kept honest by
// `packages/core/src/sdk-facade.conformance.test-d.ts`.
//
// Re-added 2026-07-19 (facade-sealing plan) — this SPI was removed on
// 2026-07-18 on the premise that it had "zero production consumers
// independent of kos" and that first-party code always imports core's
// registerDataSource/getDataSource directly. Both halves of that premise no
// longer hold: another Uplink's own fog-reveal sync needs getDataSource too
// (not just kos), and the whole point of facade-sealing kos is to stop
// "first-party code imports core directly" being true for it. See
// docs/superpowers/plans/2026-07-19-facade-sealing.md §2.1.

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
 * Base interface for all data sources. `registerDataSource`/`getDataSource`
 * on {@link GonogoHost} are typed against this so an Uplink author can both
 * author a conforming `DataSource` and reach one it registered itself.
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
// Mirrors `@ksp-gonogo/core`'s `contexts/ScreenContext.tsx` — same leaf
// constraint as the rest of this file.

/**
 * Which screen a component is mounted on. The same registered component
 * can render different UIs on main vs station when it participates in a
 * multi-role interaction (e.g. GO/NO-GO voting).
 */
export type Screen = "main" | "station";

// --- Settings tabs ---------------------------------------------------------

/**
 * Mirrors `packages/core/src/settingsTabs.ts`'s `SettingsTabDefinition` —
 * same leaf constraint. An Uplink co-locates a whole Settings-modal tab's
 * registration with the code that owns it.
 */
export interface SettingsTabDefinition {
  /** Stable id — React key and tab id. */
  id: string;
  /** Tab label shown in the Settings modal's tab strip. */
  label: string;
  /** The tab's content, rendered with no props. */
  component: ComponentType;
  /** Which screens this tab appears on. Omit for both. */
  screens?: readonly Screen[];
}

// --- Telemetry client (sitrep-client) SPI ------------------------------------
//
// Same leaf constraint as `StreamStatusValue` below: `TelemetryClient` is
// owned by `@ksp-gonogo/sitrep-client`, which the sdk cannot depend on
// either. Mirrors only the surface an Uplink author drives directly
// (subscribe/dispatch/getValue/dispose) — NOT the full class
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
// structurally) — kept honest by
// `packages/core/src/sdk-facade.conformance.test-d.ts`.

/**
 * The minimal delay-clock surface a media delay pipeline depends on — a
 * subset of `ViewClock`'s `ViewClockView` (`confirmedEdgeUt` + `onFrame`).
 * Kept structural (not `ViewClock` itself) so a camera Uplink never needs to
 * import sitrep-client just to type the clock it's handed.
 */
export interface DelayClockLike {
  /** The certainty horizon: a frame stamped at-or-before this UT is
   *  releasable. THE one delay authority — never delay-subtracted here. */
  confirmedEdgeUt(): number;
  /** Best-effort per-frame notification (real-time driven). Not required
   *  for correctness — a deterministic caller can drive releases some other
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
 * Mirrors `packages/sitrep-client/src/lifecycle.ts`'s `CommandStatus` —
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

export interface UseCommandResult {
  send: (
    args?: unknown,
    opts?: { label?: string; topic?: string },
  ) => Promise<unknown>;
  status: CommandStatus;
}

// --- Stream SPI types ---------------------------------------------------------
//
// Same leaf constraint again: `StreamStatusValue` is owned by
// `@ksp-gonogo/sitrep-client` (packages/sitrep-client/src/stream-status.ts),
// which the sdk cannot name as a workspace dependency either (sitrep-client
// itself depends on the sdk for the wire contract — naming it back would form
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
