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

export interface UseCommandResult {
  send: (payload?: unknown) => void;
  status: "idle" | "pending" | "done" | "error";
  error?: unknown;
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
