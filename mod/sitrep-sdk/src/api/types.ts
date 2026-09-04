// ---------------------------------------------------------------------------
// Author-facing type surface.
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
import type {
  AnyCommandReply,
  CommandArgs,
  CommandId,
  CommandReply,
} from "../commands";
import type { UplinkClientHandle } from "../spine/uplink-clients";
import type {
  TopicId,
  TopicPayload,
  WidgetChannelId,
  WidgetFieldPath,
} from "../topics";
import type { Value } from "../value";

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
  /** Channels this widget REQUIRES; read non-null through the manifest hook. */
  channels?: readonly WidgetChannelId[];
  /** Channels this widget OPTIONALLY consumes: each read is `| undefined`. */
  optionalChannels?: readonly WidgetChannelId[];
  /**
   * What this widget DRAWS, when that is narrower than the channels it mounts
   * on. Absent means it draws everything it mounts on. Read by alarm
   * attribution and trajectory currency, never by mounting.
   */
  fields?: readonly WidgetFieldPath[];
  behaviors?: ComponentBehavior[];
  defaultConfig?: Partial<TConfig>;
  /** Actions this component exposes to the serial input platform. */
  actions?: readonly ActionDefinition[];
  pushable?: boolean;
  /** Game-state preconditions for this widget to be "live". */
  requires?: readonly ComponentRequirement[];
  /**
   * Which seats this widget may be placed at. OMIT for the derived default:
   * available everywhere unless the widget declares a topic in a GROUND
   * domain (`spaceCenter.*`, `career.*`, `commandCentre.*`, `recovery.*`),
   * because a topic's domain already says where the thing it describes
   * physically lives and a pilot four light-minutes out cannot act on the VAB.
   *
   * That default fails CLOSED for known ground domains and OPEN for every
   * other, including every domain an Uplink invents: a third-party widget
   * reading only `vessel.*` works aboard with no annotation, and one reading
   * `career.*` is absent aboard without its author having heard of the pilot
   * seat.
   *
   * Declare this only to overrule that. `["mission-control"]` for a widget the
   * derivation would let aboard and should not; `["pilot"]` for one that only
   * makes sense aboard, which no derivation can ever infer because no topic
   * says "aboard only"; both for a mixed widget that belongs in each.
   */
  seats?: readonly Seat[];
  /** Addressable augment slots this widget owns. */
  augmentSlots?: string[];
  /**
   * Addressable CONTRIBUTION slots this widget owns, the pure-data sibling of
   * `augmentSlots`. Declared once so `useContributions([...] as const)` types its
   * keyed result off this widget's own list. A slot id is one kind or the other,
   * never both: do not list a slot here that is also in `augmentSlots`.
   */
  contributionSlots?: readonly ContributionSlotId[];
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

/**
 * Declaration-merging seam for what a widget is currently FOCUSED ON, keyed by
 * COMPONENT ID rather than by slot: a resource picker's selection, the body a
 * map is following. The framework's universal augment segments are propless by
 * construction, so a scope key cannot ride their props; the host publishes it
 * once through `WidgetScopeProvider` and any augment of that widget reads it
 * with `useWidgetScope`, both from `@ksp-gonogo/ui-kit`.
 *
 * Declared HERE, beside `SlotRegistry`, and not in ui-kit where the provider
 * and hook live, for the reason `slots.ts` exists at all: a widget in
 * `packages/components` merging its scope is invisible to an Uplink that
 * cannot see that package, so the merge has to land somewhere every Uplink
 * already compiles against.
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging seam
export interface WidgetScopeRegistry {}

/** The scope a given widget publishes; a loose record for one that publishes none. */
export type WidgetScope<C extends string> = C extends keyof WidgetScopeRegistry
  ? WidgetScopeRegistry[C]
  : Record<string, unknown>;

// --- Contributions (pure-data slot composition) ------------------------------

/**
 * Declaration-merging seam for the contribution model, mirroring
 * `SlotRegistry` above: an augmenting package (in
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
export type ContributionSlotId = keyof ContributionRegistry;

/**
 * Segment-keyed registry for HOST-INVARIANT component slot types, the sibling
 * of `ContributionRegistry`'s full-id map.
 *
 * A reusable component cannot write the full slot literal
 * `${componentId}.${segment}`, because it does not know which widget it is
 * mounted in: it writes only the SEGMENT and the primitives complete the key
 * from the widget's own meta at runtime. This maps a SEGMENT to the entry type
 * its contributions carry.
 *
 * The framework owns the universal `filters` segment here, once, so no
 * component/widget/contributor writes it. A component inventing a novel
 * host-invariant segment declares its one line co-located with its own
 * module-load self-registrations.
 */
/**
 * One badge on a widget's panel header.
 *
 * Declared here rather than in `@ksp-gonogo/ui-kit` beside the `Badge` that draws
 * it, because it is the ENTRY TYPE of the framework-universal `badges` segment
 * below: contribution data, which an Uplink writes and the contract has to name.
 * The component stays in ui-kit and re-exports this.
 *
 * `tone` is inlined rather than naming a ui-kit type because the leaf cannot
 * reach one. It is DATA, not a prop: ui-kit's `Badge` now speaks only
 * `Severity`, and a renderer folds an entry's tone onto that scale with
 * `severityFromBadgeEntryTone`.
 */
export interface BadgeEntry {
  id: string;
  label: string;
  tone?: "neutral" | "go" | "nogo" | "warn" | "info";
}

/**
 * One meter in a widget's meter stack: a labelled 0..1 bar.
 *
 * Declared here rather than beside the `Meter` that draws it, for the same
 * reason `BadgeEntry` is: it is the ENTRY TYPE of the framework-universal
 * `meters` segment, which is contribution DATA an Uplink writes and the
 * contract therefore has to name. `MeterProps` minus the styling.
 *
 * The tree already wrote this slot twice, once as data and once as React:
 * `ship-map.part-meters` is a typed widget-owned slot of exactly this shape,
 * and a per-crew-row survival augment was a `Stack` of `Meter` and nothing
 * else, i.e. zero pixels its host did not already own. This segment is what
 * lets the second kind stop being React.
 */
export interface MeterEntry {
  /** Stable id, unique within the contributing Uplink. */
  id: string;
  /** Short label above the bar; also the meter's accessible name. */
  label: string;
  /** Fill fraction, 0..1. */
  value: number;
  /** Semantic colour of the fill. Inlined for the reason `BadgeEntry.tone` is. */
  tone?: "neutral" | "go" | "warn" | "nogo" | "info";
  /** Text on the right of the header; a percentage when absent. */
  valueLabel?: string;
  /**
   * Which ROW of the host widget this meter belongs beside, when the host
   * renders a list: a kerbal's name, a part id. Absent for a whole-widget
   * meter. This is what lets a once-per-widget segment address a row, the one
   * thing an augment segment cannot do, and it is why a per-row stack of bars
   * is a contribution rather than an augment.
   */
  row?: string;
}

/**
 * One cell of a widget's core-stat strip: the label, the figure, and at most one
 * line qualifying it.
 *
 * Declared here rather than beside the `Stat` that draws it, for the reason
 * `MeterEntry` is: it is contribution DATA an Uplink writes, so the contract has
 * to name it. Unlike `MeterEntry` it is the entry of a WIDGET-LED slot rather
 * than a universal segment, because a strip of headline figures is not something
 * every widget has: the sixty that have none aggregate nothing, the same reason
 * `plots` is not a segment either.
 *
 * <internal>
 * A career overhaul's idea of what belongs beside the vanilla figures is the
 * case this was built for: the Astronaut Complex quotes funds, hire price and
 * roster occupancy, and RP-1 considers crew-in-training as core as any of them.
 * The alternative was an RP-1 branch inside a vanilla widget.
 * </internal>
 */
export interface StatEntry {
  /** Stable id, unique within the contributing Uplink. */
  id: string;
  /** The heading over the figure; also the cell's accessible label. */
  label: string;
  /**
   * The figure, as a value carrying its own unit. Rendered through the host's
   * `Unit`, so the number is laddered and the symbol drawn the same way as
   * every other reading on the screen, and a contributor never formats one.
   *
   * `null` is a reading that is absent rather than one nobody sent, and draws
   * the null token. Absent entirely, {@link text} is used instead.
   */
  value?: Value | null;
  /**
   * The figure when it is NOT a quantity: an occupancy ("3 / 13"), a name, a
   * bare count of things that carry no unit. Ignored when {@link value} is
   * given, which is the one that gets unit rendering.
   */
  text?: string;
  /** One line under the figure, qualifying it: a rate, a horizon, a count it is drawn from. */
  detail?: string;
  /**
   * How alarming the figure is. Inlined, and the same five words `BadgeEntry`
   * and `MeterEntry` carry, for the reason `BadgeEntry.tone` gives.
   */
  tone?: "neutral" | "go" | "warn" | "nogo" | "info";
}

export interface ComponentSlotRegistry {
  /**
   * The framework-universal filter segment: a contribution is a pre-filled
   * SEARCH TERM (a plain string) rendered as a toggle. Host-invariant, the same
   * string means the same thing in any widget.
   */
  filters: string;
  /**
   * The framework-universal badge segment, the
   * original auto-slot. Declared here for the same reason `filters` is: the
   * aggregation completes `${componentId}.badges` for EVERY widget, so the
   * segment is host-invariant and its entry shape belongs to the framework.
   *
   * It was missing while `UplinkClientHandle.registerContribution` took a loose
   * `compute: (topics: any) => readonly any[]` probe, so every badge contribution
   * an Uplink wrote was unchecked and resolved to the undeclared-slot fallback
   * (`Record<string, unknown>`). Collapsing that mirror to the real handle is what
   * surfaced it, in three Uplink badge files at once.
   */
  badges: BadgeEntry;
  /**
   * The framework-universal meter segment: a contribution is one labelled 0..1
   * bar, optionally addressed at a row of the host's list. Host-invariant for
   * the same reason `badges` is, a meter means the same thing in any widget,
   * and rendered by ui-kit's own `WidgetMeters`.
   */
  meters: MeterEntry;
}

/** Every segment declared as a host-invariant component slot. */
export type ComponentSlotSegment = keyof ComponentSlotRegistry;

/** The trailing segment of a completed slot id: `"resource-ops.filters"` -> `"filters"`. */
type SegmentOf<S extends string> = S extends `${string}.${infer Rest}`
  ? Rest extends `${string}.${string}`
    ? SegmentOf<Rest>
    : Rest
  : never;

/**
 * The entry type a contribution slot renders. Resolution order:
 *  1. a full slot id declared in {@link ContributionRegistry} (host-specific,
 *     the override hatch and every widget-led slot) wins outright
 *  2. else the slot's trailing SEGMENT in {@link ComponentSlotRegistry} (the
 *     host-invariant component-slot case, e.g. `*.filters` -> `string`)
 *  3. else a loose record, the out-of-repo / undeclared fallback.
 *
 * All three branches live HERE rather than in `@ksp-gonogo/ui-kit`, which used
 * to carry its own copy of this resolution. Two copies of a declaration-merge
 * seam is the one divergence shape that cannot fail loudly: an Uplink merging
 * into this package's `ContributionRegistry` and a widget merging into ui-kit's
 * were both correct-looking and landed on different interfaces, so neither
 * could see the other's slots and nothing said so.
 */
export type ContributionEntry<S extends string> =
  S extends keyof ContributionRegistry
    ? ContributionRegistry[S] extends { entry: infer E }
      ? E
      : Record<string, unknown>
    : [SegmentOf<S>] extends [ComponentSlotSegment]
      ? [SegmentOf<S>] extends [never]
        ? Record<string, unknown>
        : ComponentSlotRegistry[SegmentOf<S>]
      : Record<string, unknown>;

/** Which slot ids a declared contribution slot names as its topics. */
type DeclaredTopicUnion<S extends string> = S extends keyof ContributionRegistry
  ? ContributionRegistry[S] extends { topics: infer T extends string }
    ? T
    : never
  : never;

/**
 * The typed argument a slot's contributions receive: current values of every
 * declared topic, keyed by topic id. The `& Record<string, unknown>` tail keeps
 * a Processor dep readable by its stamped id (`topics[processor.id]`, typed
 * `unknown`) while the mapped head preserves each declared Topic's precise
 * payload type (intersection: a declared topic key keeps `TopicPayload<K>`,
 * since `X & unknown = X`).
 */
export type ContributionTopics<S extends string> = {
  readonly [K in DeclaredTopicUnion<S> & TopicId]: TopicPayload<K> | undefined;
} & Record<string, unknown>;

/**
 * The identity an aggregated entry is stamped with, for keys and for blame.
 *
 * The narrow half of an `UplinkClientHandle`: the handle carries `Dep`-shaped
 * registration methods and lives with the registry, and a full handle is
 * structurally one of these, so the aggregation stamps one straight in.
 */
export interface UplinkClientIdentity {
  id: string;
  version: string;
  name: string;
}

/** One rendered entry, tagged with provenance for keys and blame. */
export type Contributed<E> = E & {
  readonly contributionId: string;
  readonly owner?: UplinkClientIdentity;
};

/**
 * One contribution's dependency: a Topic id, a Topic's `Reading` (the value
 * AND how current it is), or a Processor handle. Mirrors core's `Dep`
 * structurally, since the leaf cannot name sitrep-client's `ProcessorHandle`.
 */
export type ContributionDep =
  | TopicId
  | { readonly reading: TopicId }
  | { readonly id: string; readonly __resultType?: unknown };

/**
 * Registration descriptor for a contribution: the data a client feeds into
 * another widget's slot. Not a mirror of anything: `spine/contributions.ts` is
 * the registry, and this is the type it registers.
 *
 * Both halves of `compute` are typed precisely, against the same
 * declaration-merged `ContributionEntry<S>` a slot owner declares in
 * `./contribution-slots.ts` and the same `ContributionTopics<S>` the aggregation
 * hands in. Neither is `any`: resolving `deps` to their values needs
 * `ContributionTopics`, which is declared above so this leaf can name it.
 */
export interface ContributionDefinition<S extends string = string> {
  /** Stable id, unique globally. Auto-namespaced when registered via the handle. */
  id: string;
  /** The slot this contribution feeds. */
  contributes: S;
  deps?: readonly ContributionDep[];
  /** Pure, and referentially stable when its inputs are unchanged. */
  compute: (
    topics: ContributionTopics<S>,
  ) => readonly ContributionEntry<S>[] | null | undefined;
  /** Domain presence gate, identical semantics to `AugmentDefinition.requires`. */
  requires?: string;
  /** Ascending, ties in registration order. */
  priority?: number;
  settings?: readonly AugmentSettingField[];
  /** Stamped by `defineUplinkClient(...).registerContribution`, never set by hand. */
  owner?: UplinkClientHandle;
}

/** Any contribution, whatever slot it feeds. */
export type AnyContribution = ContributionDefinition<string>;

export interface AugmentSettingField {
  key: string;
  type: "boolean" | "text" | "number";
  label?: string;
  default?: boolean | string | number;
}

/**
 * One contributor's settings block, namespaced for the host panel. `namespace` is
 * the contributor's id; the host stores each field under `<namespace>.<key>` in
 * the widget instance config so two contributors' identically-named settings never
 * collide, and an absent Uplink contributes nothing.
 *
 * Declared here rather than in `@ksp-gonogo/ui-kit`, which re-exports it, for the
 * reason `AugmentSettingField` already moved: it is a shape over that type, and it
 * is the return type of a registry read (`getCoverageSourceSettings`) that lives
 * in this package. ui-kit imports the sdk, so the type can only sit at this end if
 * both are to have it.
 */
export interface NamespacedAugmentSettings {
  augmentId: string;
  namespace: string;
  fields: readonly AugmentSettingField[];
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

// --- Uplink client identity ---------------------------------------------

/**
 * Re-exported rather than declared: the ONE declaration lives in
 * `../spine/uplink-clients.ts`, beside `defineUplinkClient` which returns it.
 *
 * Emphatically NOT a second, loose copy whose registration methods are `any`
 * "name+arity probes". `ResolvedDeps`, `ReckonerFor`,
 * `DerivedChannelDefinition` and `ProcessorHandle` are all sdk-side, so this
 * leaf can name every one of them, and a handle declared twice with one side
 * unchecked is the divergence shape that cannot fail loudly.
 */
export type { UplinkClientHandle } from "../spine/uplink-clients";

// --- Coverage sources --------------------------------------------------------

/**
 * Registration descriptor for a coverage source, a data contributor (coverage
 * bytes for a body under some layerId), not a renderable component. See
 * `./coverage-source.ts`'s own header for why this isn't another AugmentSlot
 * kind.
 */
export interface CoverageSourceDefinition {
  id: string;
  label?: string;
  weight?: number;
  settings?: readonly AugmentSettingField[];
}

// --- Map POI providers -------------------------------------------------------

/**
 * One action button on a `MapPoi`. Mirrors `packages/core/src/mapPoi.ts`'s
 * `MapPoiAction`: same leaf constraint as every other type in this file (see
 * module header). Named rather than inlined into `MapPoi`, so a provider can
 * build its actions in a helper and give that helper a return type.
 */
export interface MapPoiAction {
  id: string;
  label: string;
  run: () => void | Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * One point-of-interest record a `MapPoiProviderDefinition` contributes.
 * Mirrors `packages/core/src/mapPoi.ts`'s `MapPoi`: same leaf constraint as
 * every other type in this file (see module header).
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
  actions?: readonly MapPoiAction[];
}

/** What a POI provider's hook is told about the surface asking for points. */
export interface MapPoiProviderContext {
  /** The currently-mapped body. */
  bodyId: string | undefined;
}

/** A POI provider's hook: called per render of the mapping surface. */
export type UseMapPois = (
  ctx: MapPoiProviderContext,
) => readonly MapPoi[] | null | undefined;

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
  usePois: UseMapPois;
}

// --- Celestial bodies ---------------------------------------------------------

/** Texture map metadata, required for accurate lat/lon to pixel mapping. */
export interface BodyMapConfig {
  type: "equirectangular";
  /** Pixel width of the source texture image. */
  width: number;
  /** Pixel height of the source texture image. */
  height: number;
}

/**
 * Approximate exponential atmosphere model. Real KSP atmospheres are tabulated
 * and not purely exponential, but a single scale-height approximation is enough
 * to draw a recognisable pressure-vs-altitude curve and to distinguish "thin"
 * from "thick" atmospheres at a glance.
 */
export interface AtmosphereModel {
  /** Surface pressure in pascals. */
  surfacePressure: number;
  /** Scale height (e-folding altitude) in metres. */
  scaleHeight: number;
}

/**
 * A celestial body, as the registry in `./bodies.ts` stores it.
 *
 * The registry lives in this package as of 2026-08-19, so this is the real
 * declaration rather than a mirror of core's. It moved because a planet pack is an
 * Uplink's business: `registerStockBodies` is called by seven Uplink test files
 * and `registerBody` is how a pack adds or overrides an entry.
 */
export interface BodyDefinition {
  /** Unique identifier, matching the body name the telemetry stream reports. */
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
  /** Longitude correction in degrees added to a reported longitude before mapping. */
  longitudeOffset?: number;
  /** Latitude correction in degrees added to a reported latitude before mapping. */
  latitudeOffset?: number;
  /** ID of the parent body (e.g. "Kerbin" for "Mun"). Absent for the star. */
  parent?: string;
  /** Radius of the sphere of influence in metres (KSP `a·(m/M)^0.4`). */
  soi?: number;
  /** Texture map metadata, required for accurate lat/lon → pixel mapping. */
  map?: BodyMapConfig;
  /** If the body has an atmosphere */
  hasAtmosphere: boolean;
  /** The height above sea level where the atmosphere is stopped */
  maxAtmosphere: number;
  /** Optional atmosphere model. Only meaningful when `hasAtmosphere` is true. */
  atmosphere?: AtmosphereModel;
  /**
   * Representative sky/haze colour, for tinting an atmospheric readout. Only
   * meaningful when `hasAtmosphere` is true; leave unset for airless bodies so
   * consumers fall back to a neutral default.
   */
  atmosphereColor?: string;
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

// --- Coverage mask cache -----------------------------------------------------
//
// Same leaf constraint again: `BodyMask` was owned by `@ksp-gonogo/data`, which
// the sdk cannot depend on either (data itself depends on core, which depends on
// the sdk, naming data here would form the same turbo `^build` cycle). Mirrored
// here for that reason, and the cache itself has since moved to
// `./coverage/CoverageMaskCache.ts` beside it.

export interface BodyMask {
  readonly bodyId: string;
  readonly layerId: string;
  readonly width: number;
  readonly height: number;
  /** Alpha bytes, row-major. Mutable: caller writes directly. */
  data: Uint8Array;
}

/**
 * The subset of `CoverageMaskCache`'s (`@ksp-gonogo/data`) public surface an
 * author drives from `useCoverageMaskCache()`. Not itself part of the barrel's
 * named export list: every call site so far only ever holds this through
 * the hook's inferred return type (`const cache = useCoverageMaskCache();`),
 * never by importing the type name directly, so there is nothing to add to
 * the export list for it.
 */
export interface CoverageMaskCacheHandle {
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
// `GonogoHost` deliberately carries NO `registerDataSource`/`getDataSource`
// author SPI. An Uplink needing either reaches for its own non-SPI substitute
// instead: a singleton-handle registration, or a lifecycle-managed telemetry
// subscribe. The type mirror itself stays: an Uplink that carries its
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
// Mirrors `../spine/screen.tsx`, which owns the declarations and the hooks that
// answer in them: same leaf constraint as the rest of this file. The hooks are
// on the root barrel, so an author reaching a type here and a hook there lands
// on one vocabulary.

/**
 * Which screen a component is mounted on: a DEPLOYMENT CONFIGURATION, not a
 * role. `"main"` is direct-WS and peer-hosting, `"station"` is peer-fed,
 * `"pilot"` is direct-WS aboard the craft without hosting. The same registered
 * component can render different UIs on each when it participates in a
 * multi-role interaction (e.g. GO/NO-GO voting).
 */
export type Screen = "main" | "station" | "pilot";

/**
 * Where the operator is physically sitting. Derived from the screen by
 * `seatOf`, never declared beside it: a widget's availability and a message's
 * light-time are both questions about the seat, and a peer-fed pilot is a
 * different screen at the same seat.
 */
export type Seat = "mission-control" | "pilot";

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
 * `registerSetting` is the PREFERRED way an Uplink surfaces a setting: a
 * declarative row the app renders and (for client-pref) persists, without a
 * bespoke tab. Reach for `registerSettingsTab` only when a setting's UI
 * genuinely can't be a row.
 *
 * Re-exported, never restated. The registry is `../spine/settings-registry`,
 * inside this package, so this leaf can name its declarations directly. A
 * hand-copied MIRROR gives two unions meaning the same thing, and they drift:
 * `readOnly`, `"number"` and `group` all had to be unpicked from one.
 */
export type {
  ClientPrefSetting,
  ClientPrefSettingOf,
  SettingDefinition,
  SettingDefinitionBase,
  SettingDefinitionOf,
  SettingType,
  SettingValue,
  SettingValueByType,
  SourceBackedSetting,
  SourceBackedSettingOf,
  StreamBackedSetting,
  StreamBackedSettingOf,
} from "../spine/settings-registry";

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

// The real one, from this package's own `perf/PerfBudget.ts`. It was mirrored
// here, like every other type in this file, because the class lived in
// `@ksp-gonogo/core` and the leaf could not name it. The class is now in this
// package, so there is nothing left to mirror and a second declaration would just
// be one more thing to drift.
export type { PerfBudgetOptions } from "../perf/PerfBudget";

/** The subset of `PerfBudget` an author touches after construction. */
export interface PerfBudgetHandle {
  record(amount?: number, now?: number): void;
}

// --- Hook result shapes -----------------------------------------------------

// The real one, from this package's own `spine/lifecycle.ts`, for the same
// reason `PerfBudgetOptions` above stopped being mirrored: `CommandStatus` used
// to live in `@ksp-gonogo/sitrep-client`, which the sdk could not name as a
// workspace dependency, so it was copied here verbatim. The spine moved into
// this package and the copy immediately became what a copy always becomes: the
// `refused` arm gained the fields that let a refusal be SAID and this one did
// not, so the two disagreed about what a refusal carries.
import type { CommandGateStatus } from "../spine/command-gate";
import type {
  CommandLoss,
  CommandRefusal,
  CommandStatus,
} from "../spine/lifecycle";

export type { CommandGateStatus } from "../spine/command-gate";
export type {
  CommandLoss,
  CommandRefusal,
  CommandRefusalDetail,
  CommandStatus,
} from "../spine/lifecycle";

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

/** The per-call options `useCommand` takes. */
export interface UseCommandOptions {
  /**
   * Per-call vantage override (delay-UX): the command centre this command
   * dispatches from. Omit to use the connection's session vantage (the
   * default); pass `"meta"` for a program-meta command (tech/strategy/contract)
   * so it stays instant regardless of the selected centre.
   */
  vantage?: string;
}

/**
 * Mirrors the spine's `UseCommandResult`: same leaf constraint as every other
 * type in this file. `TArgs`/`TReply` come from the generated command map when
 * the hook was given a known `CommandId`, and `TReply` falls back to
 * {@link AnyCommandReply} rather than to `unknown`, for the reason that type
 * gives.
 *
 * `send` is a method rather than a property holding a function for the reason
 * the spine's copy gives: as a property, `strictFunctionTypes` checks the
 * parameter contravariantly and a typed handle stops being assignable to the
 * bare `UseCommandResult` that `<CommandDelay handle>` takes.
 */
export interface UseCommandResult<TArgs = unknown, TReply = AnyCommandReply> {
  send(
    args?: TArgs,
    opts?: { label?: string; topic?: string },
  ): Promise<TReply>;
  status: CommandStatus;
  inFlight: InFlightCommand[];
  /** Delay display this command uses; hand straight to `<CommandDelay>`. */
  shape: "discrete" | "stream";
  /** Effective one-way delay under this command's vantage (0 = instant). */
  effectiveDelaySeconds: number;
  /** Clear a dead (`overdue`/`lost`) command from `inFlight`, or a refusal from
   *  `refusals`; the manual out for anything that would otherwise sit forever.
   *  See the spine's own doc. */
  dismiss: (id: string) => void;
  /** Dispatches from this hook the game REFUSED, until dismissed. See the
   *  spine's `UseCommandResult.refusals`. */
  refusals: CommandRefusal[];
  /** Dispatches from this hook that got NO ANSWER, until dismissed. See the
   *  spine's `UseCommandResult.losses`. */
  losses: CommandLoss[];
  /** What the mod says about this command in ADVANCE, off `system.uplink.gates`;
   *  `undefined` when nothing is known. See the spine's `CommandGateStatus`. */
  gate?: CommandGateStatus;
  /** Dev-only must-consume token (absent in production). See `CommandOutputToken`. */
  _output?: CommandOutputToken;
}

/**
 * The handle for a NAMED command, with both its argument type and its reply type
 * resolved out of the generated command map.
 *
 * What to write on a prop, a field, or a helper that passes a dispatch handle
 * around: `useCommand("...")` already returns this, and the place a handle loses
 * its types is the annotation it travels through. It takes a union of ids as
 * readily as one, so a family of commands that answer alike can be declared
 * once, and an Uplink's own augmented `CommandArgsMap` keys work here with
 * nothing extra registered.
 *
 * See the spine's copy for why it is named off `UseCommandResult` rather than
 * `CommandHandle`.
 */
export type UseCommandResultFor<C extends CommandId> = UseCommandResult<
  CommandArgs<C>,
  CommandReply<C>
>;

/**
 * One Uplink's own method call, as `useUplinkRelay` hands it over. `method` and
 * `args` mean whatever the Uplink's registered handle says they mean; nothing
 * between the caller and that handle interprets either.
 *
 * Rejects with an `Error` on no route (no handle registered, or a station with
 * no live link) and on a throw inside the handle, whose own extra Error
 * properties survive the hop so a client can read back what its own host code
 * classified.
 */
export type UplinkRelay = (method: string, args?: unknown) => Promise<unknown>;

/**
 * The ICE servers the main screen is handing out, for an Uplink opening a media
 * connection from a station.
 *
 * A station cannot fetch its own TURN credentials: the relay that issues them is
 * reachable from the main screen, and the loopback address a main screen would
 * use resolves on a station to the station itself. So the main screen broadcasts
 * them and this is where an Uplink reads them.
 *
 * Imperative rather than a plain array because the consumer is an
 * `RTCPeerConnection` config rather than JSX, and because credentials rotate:
 * a connection opened before a rotation has to be able to see the new ones
 * without the Uplink re-rendering anything.
 */
export interface HostIceServers {
  /** What to use right now. Empty where the host is not issuing any, including the main screen. */
  current(): RTCIceServer[];
  /** Notified when the host issues a fresh set. Returns an unsubscribe. */
  onChange(cb: (servers: RTCIceServer[]) => void): () => void;
}

/** What {@link useRouteCommands} answers with: the queue for one topic, and the delay mode it is under. */
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
  | "recorded"
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
 * plain `string` argument (a runtime-templated topic, e.g. a per-body coverage
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
