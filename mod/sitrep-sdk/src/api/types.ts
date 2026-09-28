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
import type { RailDirection, RailTags } from "../rail-tags";
import type { Reading } from "../reading";
import type { UplinkClientHandle } from "../spine/uplink-clients";
import type {
  TopicId,
  TopicPayload,
  WidgetChannelId,
  WidgetFieldPath,
} from "../topics";
import type { Value } from "../value";

/**
 * A dashboard component's declared data dependency, e.g. `"vessel.altitude"`.
 *
 * @category Registering
 */
export type DataRequirement = string;

/**
 * Behaviours a component can opt into; `gonogo-participant` joins GO/NO-GO.
 *
 * @category Registering
 */
export type ComponentBehavior = "gonogo-participant";

/**
 * Game-state preconditions the orchestrator dims a widget when unmet.
 *
 * @category Registering
 */
export type ComponentRequirement = "flight" | "career";

// --- Serial input actions ---------------------------------------------------

/**
 * The kind of input that can drive an action: a button, or an analog axis.
 *
 * @category Actions
 */
export type ActionInputKind = "button" | "analog";

/**
 * What an action handler receives from a bound input.
 *
 * @category Actions
 */
export interface ActionInputPayload {
  kind: ActionInputKind;
  /** Button: true=pressed, false=released. Analog: normalised to -1..1. */
  value: boolean | number;
  /** Device-specific raw value before normalisation, if the handler wants it. */
  raw?: unknown;
}

/**
 * One action a widget declares in `ComponentDefinition.actions`, which an
 * operator can bind to a key, button or axis.
 *
 * @category Actions
 */
export interface ActionDefinition {
  /** Stable ID used when persisting an input→action mapping. Unique per component. */
  id: string;
  label: string;
  /** Which input kinds may drive this action. */
  accepts: readonly ActionInputKind[];
  description?: string;
}

/**
 * Typed handler map for {@link useActionInput}, keyed by each action's `id`.
 *
 * @category Actions
 */
export type ActionHandlers<Actions extends readonly ActionDefinition[]> = {
  [ActionId in Actions[number]["id"]]: (payload: ActionInputPayload) => unknown;
};

// --- Component registration -------------------------------------------------

/**
 * Props passed to every registered dashboard component.
 *
 * @category Registering
 */
export interface ComponentProps<Config = Record<string, unknown>> {
  config?: Config;
  id: string;
  w?: number;
  h?: number;
  onConfigChange?: (config: Config) => void;
}

/**
 * Props passed to a component's config UI (rendered inside a modal).
 *
 * @category Registering
 */
export interface ConfigComponentProps<Config = Record<string, unknown>> {
  config: Config;
  onSave: (config: Config) => void;
}

/**
 * Registration descriptor for a dashboard component.
 *
 * @category Registering
 */
export interface ComponentDefinition<Config = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  /** Free-form tags; UI may style known values (e.g. 'telemetry', 'control'). */
  tags: string[];
  component: ComponentType<ComponentProps<Config>>;
  /** Config UI rendered inside a modal; shown via the gear icon. */
  configComponent?: ComponentType<ConfigComponentProps<Config>>;
  openConfigOnAdd?: boolean;
  defaultSize?: { w: number; h: number };
  minSize?: { w: number; h: number };
  mobileWidth?: "full" | "half";
  mobileHeight?: number;
  dataRequirements?: DataRequirement[];
  /**
   * Channels this widget REQUIRES. Declaring one is not what creates the
   * subscription: {@link useTelemetry} subscribes on its own, declared or not.
   * What it does is gate the mount. The dashboard resolves each required
   * channel to the Uplink that owns it, and when that Uplink reports itself
   * degraded or unavailable the widget is replaced by that Uplink's own reason
   * line instead of rendering empty.
   */
  channels?: readonly WidgetChannelId[];
  /**
   * Channels this widget OPTIONALLY consumes. Identical to `channels` for
   * reading: the same `Reading`, not a `| undefined` of it. The whole
   * behavioural difference is the gate above, and it is that these are never
   * put through it, so an unhealthy optional channel never blocks the render.
   */
  optionalChannels?: readonly WidgetChannelId[];
  /**
   * What this widget DRAWS, when that is narrower than the channels it mounts
   * on. Absent means it draws everything it mounts on. Read by alarm
   * attribution and trajectory currency, never by mounting.
   */
  fields?: readonly WidgetFieldPath[];
  behaviors?: ComponentBehavior[];
  defaultConfig?: Partial<Config>;
  /** Actions this component exposes to the serial input platform. */
  actions?: readonly ActionDefinition[];
  pushable?: boolean;
  /** Game-state preconditions for this widget to be "live". */
  requires?: readonly ComponentRequirement[];
  /**
   * Which seats this widget may be placed at. OMIT for the derived default:
   * available everywhere unless the widget declares a topic in a GROUND
   * domain (`spaceCenter.*`, `career.*`, `recovery.*`, and `commandCentre.*`
   * other than its roster and separation), because a topic's domain already
   * says where the thing it describes physically lives and a pilot four
   * light-minutes out cannot act on the VAB.
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
 *
 * @category Registering
 */
export interface ThemeDefinition {
  id: string;
  name: string;
  theme: unknown;
}

// --- Augments (slot composition) --------------------------------------------

/**
 * Every augment slot, keyed by slot id, mapped to the props the slot passes its
 * augments. An augment is a React component an Uplink binds to a slot with
 * `registerAugment`; the widget renders it in place.
 *
 * A widget that owns a slot declares it here by declaration merging, so an
 * augment of a misspelled slot does not typecheck.
 *
 * @category Extensions
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging seam
export interface SlotRegistry {}

/**
 * The id of an augment slot some widget declares.
 *
 * @category Extensions
 */
export type SlotId = keyof SlotRegistry;

/**
 * An open record when the id has been erased to `string`, which is what a
 * REGISTRY READ holds: it fished the value out by a string key and knows
 * nothing about what was declared. `never` for an id that IS named and that
 * nothing declares, so a typo describes no shape at all.
 */
type ErasedOrNever<Slot extends string> = string extends Slot
  ? Record<string, unknown>
  : never;

/**
 * The props a slot passes to each of its augments. `never` for a slot id no
 * widget declares, so an augment of a misspelled slot does not typecheck.
 *
 * @category Extensions
 */
export type SlotProps<Slot extends string> = Slot extends keyof SlotRegistry
  ? SlotRegistry[Slot]
  : never;

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
 *
 * @category Registering
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging seam
export interface WidgetScopeRegistry {}

/**
 * The scope a given widget publishes, and `never` for a NAMED widget that
 * publishes none. A `Widget` erased to `string` gets the open record, for the reason
 * {@link ErasedOrNever} gives.
 *
 * @category Registering
 */
export type WidgetScope<Widget extends string> =
  Widget extends keyof WidgetScopeRegistry
    ? WidgetScopeRegistry[Widget]
    : ErasedOrNever<Widget>;

// --- Contributions (pure-data slot composition) ------------------------------

/**
 * Every contribution slot, keyed by slot id, mapped to the entry its
 * contributions produce. A contribution is data an Uplink computes from Topics
 * with `registerContribution`; the widget owns how it is drawn.
 *
 * A contribution reads the Topics it names in its own `deps`, and any Topic
 * may be named there.
 *
 * @category Extensions
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging seam
export interface ContributionRegistry {}

/**
 * The entry type a `ContributionRegistry` slot's contributions render,
 * mirroring `packages/core/src/contributions.ts`'s own `ContributionEntry<Slot>`
 * (same name, same extraction: `ContributionRegistry[S] extends { entry:
 * infer Entry } ? Entry : ...`), same leaf constraint as `SlotProps<Slot>` above. An
 * Uplink contribution built against `ContributionEntry<"ship-map.part-
 * meters">` gets the real, host-declared entry shape once
 * `./contribution-slots.ts` mirrors that slot; a slot not yet declared here
 * falls back to the loose bag, matching `SlotProps`'s own fallback.
 *
 * @category Extensions
 */
export type ContributionSlotId = keyof ContributionRegistry;

/**
 * One badge on a widget's panel header: the entry of the `badges` segment.
 *
 * @category Extensions
 */
export interface BadgeEntry {
  /** Stable id, unique within the contributing Uplink. */
  id: string;
  /** The badge's text. */
  label: string;
  /** How the badge reads. The host maps it onto its severity scale. */
  tone?: "neutral" | "go" | "nogo" | "warn" | "info";
}

/**
 * One labelled bar in a widget's meter list: the entry of the `meters`
 * segment. The widget draws it with ui-kit's `Meter`.
 *
 * @category Extensions
 */
export interface MeterEntry {
  /** Stable id, unique within the contributing Uplink. */
  id: string;
  /** Short label above the bar; also the meter's accessible name. */
  label: string;
  /** The fill, as a `ratio` quantity or the whole {@link Reading} of one. */
  value: Value<"ratio"> | Reading<Value<"ratio">>;
  /** Semantic colour of the fill. */
  tone?: "neutral" | "go" | "warn" | "nogo" | "info";
  /** Text on the right of the header; a percentage when absent. */
  valueLabel?: string;
  /**
   * Which row of the host widget this meter belongs beside, when the host
   * renders a list: a kerbal's name, a part id. Absent for a whole-widget
   * meter.
   */
  row?: string;
}

/**
 * One cell of a widget's core-stat strip: the label, the figure, and at most one
 * line qualifying it.
 *
 * Contribution data an Uplink writes, so the contract names it. Unlike
 * `MeterEntry` it is the entry of a WIDGET-LED slot rather
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
 *
 * @category Extensions
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
   * How alarming the figure is: the same five words `BadgeEntry` and
   * `MeterEntry` carry.
   */
  tone?: "neutral" | "go" | "warn" | "nogo" | "info";
}

/**
 * The contribution segments a reusable component draws, keyed by segment and
 * mapped to the entry type its contributions produce. The full slot id is
 * `${componentId}.${segment}`, for the widget the component is mounted in.
 *
 * Only `badges` is on every widget. `filters` and `meters` exist on a widget
 * only where it renders the component that draws them.
 *
 * @category Extensions
 */
export interface ComponentSlotRegistry {
  /**
   * A pre-filled search term, drawn as a toggle by a widget that shows a
   * `FilterList`.
   */
  filters: string;
  /** One badge on the widget's panel header. Every widget carries it. */
  badges: BadgeEntry;
  /**
   * One labelled bar, drawn by a widget that renders `WidgetMeters`, optionally
   * beside one row of its list.
   */
  meters: MeterEntry;
}

/**
 * Every segment declared as a host-invariant component slot.
 *
 * @category Extensions
 */
export type ComponentSlotSegment = keyof ComponentSlotRegistry;

/** The trailing segment of a completed slot id: `"resource-ops.filters"` -> `"filters"`. */
type SegmentOf<Slot extends string> = Slot extends `${string}.${infer Rest}`
  ? Rest extends `${string}.${string}`
    ? SegmentOf<Rest>
    : Rest
  : never;

/**
 * The entry a contribution to a slot returns from `compute`: the entry the
 * widget declares for that slot, or for a slot every widget carries, such as
 * `badges`, that slot's entry.
 *
 * @category Extensions
 */
export type ContributionEntry<Slot extends string> =
  Slot extends keyof ContributionRegistry
    ? ContributionRegistry[Slot] extends { entry: infer Entry }
      ? Entry
      : never
    : [SegmentOf<Slot>] extends [ComponentSlotSegment]
      ? [SegmentOf<Slot>] extends [never]
        ? ErasedOrNever<Slot>
        : ComponentSlotRegistry[SegmentOf<Slot>]
      : ErasedOrNever<Slot>;

/**
 * The identity an aggregated entry is stamped with, for keys and for blame.
 *
 * The narrow half of an `UplinkClientHandle`: the handle carries `Dep`-shaped
 * registration methods and lives with the registry, and a full handle is
 * structurally one of these, so the aggregation stamps one straight in.
 *
 * @category Registering
 */
export interface UplinkClientIdentity {
  id: string;
  version: string;
  name: string;
}

/**
 * One rendered entry, tagged with provenance for keys and blame.
 *
 * @category Extensions
 */
export type Contributed<Entry> = Entry & {
  readonly contributionId: string;
  readonly owner?: UplinkClientIdentity;
};

/**
 * One contribution's dependency: a Topic id, a Topic's `Reading` (the value
 * AND how current it is), or a Processor handle. Mirrors core's `Dep`
 * structurally, since the leaf cannot name sitrep-client's `ProcessorHandle`.
 *
 * @category Extensions
 */
export type ContributionDep =
  | TopicId
  | { readonly reading: TopicId }
  | {
      readonly id: string;
      readonly __resultType?: unknown;
      readonly __carriesCurrency?: boolean;
    };

/**
 * The KEY the aggregation writes one dep's value under: a Topic id under
 * itself, a reading dep under the topic it names, a Processor under its
 * owner-stamped id.
 */
type DepKey<Dependency> = Dependency extends string
  ? Dependency
  : Dependency extends { readonly reading: infer Topic extends string }
    ? Topic
    : Dependency extends { readonly id: infer ProcessorId extends string }
      ? // A processor whose id is still the unnarrowed `string` contributes NO
        // key. It would otherwise contribute a string index signature, which
        // reopens every key on the record and puts back exactly the hole this
        // type exists to close: one loosely-typed dep would make an undeclared
        // topic readable again for that whole contribution. A handle from
        // `defineProcessor`/`registerProcessor` always carries its stamped id;
        // one from `defineProcessorContract` only does when the caller names it.
        string extends ProcessorId
        ? never
        : ProcessorId
      : never;

/**
 * The VALUE that arrives under that key.
 *
 * <para>A Topic's value is three distinct facts. `undefined` is no point yet:
 * the Topic has never arrived, or not since the last rewind. `null` is a point
 * the mod sent to say there is nothing to describe (a tombstone). Anything else
 * is the payload. Neither absence is a zero, and the two are not the same
 * absence, so a contribution that draws anything for one must decide what it
 * draws for the other.</para>
 *
 * <para>A reading dep resolves to the topic's PAYLOAD here, not to its
 * `Reading`, and that is a statement about the aggregation rather than about
 * the dep: `SlotAggregator` stores `point.payload` for a bare id and a reading
 * dep alike. The processor pipeline does hand a reading dep a `Reading`
 * (`ResolvedDep` in `spine/processors.ts`), so the two pipelines genuinely
 * differ; this types what a contribution is actually given. No contribution in
 * the tree uses a reading dep today, so nothing is relying on either reading of
 * it.</para>
 *
 * <para>A PROCESSOR dep is the other way round and must track the evaluator
 * exactly: a processor whose own deps include a reading answers a `Reading`,
 * and the stored value a contribution is handed is that same answer. Typing it
 * as the bare result here would hand a contribution a reading while telling it
 * otherwise, which is the defect the brand exists to prevent.</para>
 */
type DepValue<Dependency> = Dependency extends string
  ? TopicPayload<Dependency & TopicId> | null | undefined
  : Dependency extends { readonly reading: infer Topic }
    ? Topic extends TopicId
      ? TopicPayload<Topic> | null | undefined
      : never
    : Dependency extends {
          readonly id: string;
          readonly __resultType?: infer Result;
        }
      ? Dependency extends { readonly __carriesCurrency?: true }
        ? Reading<Result> | undefined
        : Result | undefined
      : never;

/**
 * The argument a contribution's `compute` receives: each Topic named in its
 * `deps`, keyed by the Topic's id and typed by its payload. A Topic not named
 * in `deps` cannot be read.
 *
 * A Topic's value is `undefined` until its first sample arrives, and `null`
 * while the mod reports that it has nothing to describe. When samples stop, it
 * keeps its last value.
 *
 * @category Extensions
 */
export type DepTopics<Deps extends readonly ContributionDep[]> = {
  readonly [Dependency in Deps[number] as DepKey<Dependency>]: DepValue<Dependency>;
};

/**
 * What an Uplink client handle's `registerContribution` takes: a function
 * that turns Topics into entries for another widget's slot. The widget draws
 * the entries itself.
 *
 * `Slot` is inferred from `contributes` and `Deps` from `deps`, so `compute` is
 * checked against both.
 *
 * @remarks
 * - `compute` receives one object holding every Topic named in `deps` by any
 *   contribution to the slot, all read at the same instant: the instant the
 *   dashboard is showing, so under signal delay they lag as every widget does.
 *   The same object is passed to every contribution to the slot.
 * - A Topic's value is `undefined` until its first sample arrives, and `null`
 *   while the mod reports that it has nothing to describe. When samples stop
 *   or the link drops, it keeps its last value, and nothing in the object says
 *   that it is being held.
 * - The Topics are read at most once per animation frame. A value stays the
 *   same object until a new sample of it is shown, and a Topic the mod sends
 *   directly gives a new object for every sample, even one identical to the
 *   last. When several samples arrive within one frame, `compute` sees only
 *   the latest.
 * - `compute` runs when the widget mounts, and again whenever a value in the
 *   object changes, including a Topic that only another contribution to the
 *   slot named, whenever the slot's contributions change, and whenever a
 *   `requires` Domain comes or goes. Nothing is memoised: it can run again
 *   with the same values, and it runs separately for each widget on the
 *   dashboard that carries the slot.
 * - `compute` runs synchronously, in a React effect after the render that read
 *   the new values, and the widget draws the entries on its next render. A
 *   promise returned in place of the entries is reported as an error.
 * - A `compute` that throws is logged and skipped for that run. The slot's
 *   other contributions still draw.
 * - The widget redraws only when the slot's entries change. Each entry is
 *   compared field by field with the one before it, so returning equal entries
 *   causes no redraw, while a field holding a new object, such as a fresh
 *   `value(...)`, counts as a change.
 * - Only the highest `priority` band registered to the slot runs. A
 *   contribution whose `requires` Domain is not present draws nothing, but
 *   still holds its band, so lower bands stay hidden.
 *
 * @category Extensions
 */
export interface ContributionDefinition<
  Slot extends string = string,
  Deps extends readonly ContributionDep[] = readonly ContributionDep[],
> {
  /** Stable id, unique within the Uplink. The handle prefixes it with the Uplink's own id. */
  id: string;
  /** The slot to fill, such as `"crew-status.meters"`. */
  contributes: Slot;
  /**
   * The Topics this contribution reads. Naming a Topic here is what subscribes
   * to it, and `compute` receives each one, typed by its payload; a Topic left
   * out cannot be read.
   */
  deps?: Deps;
  /**
   * Returns this contribution's entries for the slot, or `null` for none. It
   * must return them directly, not through a promise, and it runs again
   * whenever a Topic the slot reads changes.
   *
   * A Topic that is `null` or `undefined` has no value to draw, so return no
   * entries for it rather than a zero, an empty count or a nominal state.
   */
  compute: (
    topics: DepTopics<Deps>,
  ) => readonly ContributionEntry<Slot>[] | null | undefined;
  /**
   * A Domain id. `compute` runs only while that Domain is present; while it is
   * not, the contribution draws nothing.
   */
  requires?: string;
  /**
   * Which band this contribution belongs to. Only the highest band present in
   * a slot renders, and every contribution in it renders, in registration
   * order. A widget filling its own slot sits at 0, so a contribution at the
   * default replaces the widget's own entries rather than appearing beside
   * them.
   *
   * @defaultValue `1`
   */
  priority?: number;
  /** Per-instance settings this contribution adds to the host widget's settings panel, stored under its `id`. */
  settings?: readonly AugmentSettingField[];
  /** Stamped by `defineUplinkClient(...).registerContribution`, never set by hand. */
  owner?: UplinkClientHandle;
}

/**
 * Any contribution, whatever slot it feeds: what the REGISTRY stores once the
 * slot and the dep tuple have been erased.
 *
 * <para>Its `compute` takes an open record, and that is the honest signature for
 * this type rather than a hole in the authoring one. A caller holding an
 * `AnyContribution` has fished it out of a registry keyed by string and knows
 * nothing about what it declared; the aggregation itself builds the record
 * dynamically. The precision lives on `ContributionDefinition`, which is what an
 * author writes and what `registerContribution` infers, and nothing can reach
 * this erased form to read a topic it never declared.</para>
 *
 * @category Extensions
 */
export type AnyContribution = Omit<
  ContributionDefinition<string, readonly ContributionDep[]>,
  "compute"
> & {
  compute: (
    topics: Record<string, unknown>,
  ) => readonly Record<string, unknown>[] | null | undefined;
};

/**
 * One setting an augment or contribution adds to its host widget's settings.
 *
 * @category Extensions
 */
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
 *
 * @category Extensions
 */
export interface NamespacedAugmentSettings {
  augmentId: string;
  namespace: string;
  fields: readonly AugmentSettingField[];
}

/**
 * What `registerAugment` takes: a component the widget renders inside one of
 * its slots.
 *
 * `Slot` is inferred from `augments`, so `component` is checked against the props
 * that slot passes.
 *
 * @remarks
 * - The widget renders the component as an ordinary child wherever it places
 *   the slot: once for a slot on the whole widget, once per row for a slot on
 *   each row.
 * - The component receives the slot's props and nothing else. A slot with no
 *   props passes none, and no telemetry is passed in: the component reads the
 *   Topics it needs with `useTelemetry`, exactly as a widget does.
 * - It renders every time the widget renders that part of itself, whether or
 *   not its props changed, because the widget does not memoise it. The props
 *   object is new on every render, and the values in it are the widget's own.
 * - Its state lasts as long as the widget keeps the slot mounted and the
 *   augment stays registered and present. Registering a different component
 *   under the same `id` replaces it, and the new one starts with fresh state.
 * - While its `requires` Domain is not present it is not mounted at all, so
 *   its state is lost, and it mounts afresh when the Domain returns. A Domain
 *   is present from the first value its `<domain>.available` Topic delivers,
 *   and stays present while that value is held.
 * - If it throws while rendering, the whole widget shows its error message
 *   with a retry, as it does for an error of its own.
 *
 * @category Extensions
 */
export interface AugmentDefinition<Slot extends string = string> {
  /** Stable id, unique across every Uplink. Registering the same id again replaces the earlier augment. */
  id: string;
  /** The slot to render in, such as `"crew-status.avatar"`. */
  augments: Slot;
  /**
   * The component the widget renders in the slot. It receives the slot's
   * props, {@link SlotProps}, and reads any Topic it needs itself.
   */
  component: ComponentType<SlotProps<Slot>>;
  /** The Topics the component reads, listed on the Uplink's generated page. */
  channels?: readonly TopicId[];
  /**
   * A Domain id. The augment renders only while the host reports that Domain
   * present, so it stays hidden while its mod is not running.
   */
  requires?: string;
  /**
   * Order among the augments in one slot, lowest first; ties render in
   * registration order.
   *
   * @defaultValue `0`
   */
  priority?: number;
  /** Per-instance settings this augment adds to the host widget's settings panel, stored under its `id`. */
  settings?: readonly AugmentSettingField[];
  /**
   * While this augment is registered, the widget draws none of its own
   * content for the slot, so the augment replaces it rather than adding to it.
   */
  suppressesVanillaBase?: boolean;
  /** The handle `defineUplinkClient` returned, naming the Uplink that registered this augment. */
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
 *
 * @category Maps and coverage
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
 *
 * @category Maps and coverage
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
 *
 * @category Maps and coverage
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

/**
 * What a POI provider's hook is told about the surface asking for points.
 *
 * @category Maps and coverage
 */
export interface MapPoiProviderContext {
  /** The currently-mapped body. */
  bodyId: string | undefined;
}

/**
 * A POI provider's hook: called per render of the mapping surface.
 *
 * @category Maps and coverage
 */
export type UseMapPois = (
  ctx: MapPoiProviderContext,
) => readonly MapPoi[] | null | undefined;

/**
 * Registration descriptor for a map point-of-interest provider, a data
 * contributor (points for the currently-mapped body), not a renderable
 * component. See packages/core/src/mapPoi.ts's own header for why MapView
 * owns the one shared hover/action/marker-styling surface instead of this
 * being another AugmentSlot kind.
 *
 * @category Maps and coverage
 */
export interface MapPoiProviderDefinition {
  /** "<uplinkId>:<name>", e.g. "vanilla:spaceCenter", "example-uplink:anomalies". */
  id: string;
  /** Domain presence gate, same semantics as AugmentDefinition.requires. */
  requires?: string;
  usePois: UseMapPois;
}

// --- Celestial bodies ---------------------------------------------------------

/**
 * Texture map metadata, required for accurate lat/lon to pixel mapping.
 *
 * @category Maps and coverage
 */
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
 *
 * @category Solar system and fleet
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
 *
 * @category Solar system and fleet
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

/**
 * One body's coverage mask for one layer: a grid of alpha bytes over the body's
 * map.
 *
 * @category Maps and coverage
 */
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
 *
 * @category Maps and coverage
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

/**
 * The connection state of a `DataSource`.
 *
 * @category Registering
 */
export type DataSourceStatus =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

/**
 * One key a `DataSource` offers, as `DataSource.schema` lists it.
 *
 * @category Registering
 */
export interface DataKey {
  key: string;
  description?: string;
}

/**
 * One field of a `DataSource`'s settings form, as `DataSource.configSchema`
 * lists it.
 *
 * @category Registering
 */
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
 *
 * @category Registering
 */
export interface DataSource<
  Config extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  name: string;
  connect(): Promise<void>;
  disconnect(): void;
  status: DataSourceStatus;
  schema(): DataKey[];
  subscribe(key: string, cb: (value: unknown) => void): () => void;
  onStatusChange(cb: (status: DataSourceStatus) => void): () => void;
  configSchema(): ConfigField[];
  configure(config: Record<string, unknown>): void;
  getConfig(): Config;
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
 *
 * @category Host and runtime
 */
export type Screen = "main" | "station" | "pilot";

/**
 * Where the operator is physically sitting. Derived from the screen by
 * `seatOf`, never declared beside it: a widget's availability and a message's
 * light-time are both questions about the seat, and a peer-fed pilot is a
 * different screen at the same seat.
 *
 * @category Host and runtime
 */
export type Seat = "mission-control" | "pilot";

// --- Settings tabs ---------------------------------------------------------

/**
 * Mirrors `packages/core/src/settingsTabs.ts`'s `SettingsTabDefinition`:
 * same leaf constraint. An Uplink co-locates a whole Settings-modal tab's
 * registration with the code that owns it.
 *
 * @category Settings
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
  /**
   * The Uplink this tab belongs to, by its id. The tab is then drawn as a
   * section of that Uplink's page under the Uplinks tab, titled `label`,
   * rather than as a tab of its own.
   */
  uplink?: string;
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

/**
 * The connection to the telemetry stream: subscribe to a Topic, read its latest
 * value, and send a command. Reach it with `getActiveTelemetryClient` or
 * `useTelemetryClientOptional`.
 *
 * @category Reading telemetry
 */
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
 *
 * @category Delay and vantage
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

/**
 * The subset of `PerfBudget` an author touches after construction.
 *
 * @category Logging and performance
 */
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
  CommandFound,
  CommandLoss,
  CommandRefusal,
  CommandStatus,
  CommandUndelivered,
} from "../spine/lifecycle";

export type { CommandGateStatus } from "../spine/command-gate";
export type {
  CommandFound,
  CommandFoundOutcome,
  CommandLoss,
  CommandRefusal,
  CommandRefusalDetail,
  CommandStatus,
  CommandUndelivered,
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
  direction: RailDirection;
  dispatchedAt: number;
  oneWaySeconds: number;
  reachEtaSeconds: number | null;
  replyEtaSeconds: number | null;
  predictedPhase: PredictedPhase;
}

/**
 * Mirrors `packages/ui-kit/src/CommandDelay`'s `CommandOutputToken`, the
 * dev-only must-consume token `useCommand` hands out: `<CommandDelay>` flips
 * `consumed` on mount so a delayed command can't be dispatched without its
 * delay UX. Absent in production. Same leaf constraint as every other type.
 *
 * @category Commands
 */
export interface CommandOutputToken {
  consumed: boolean;
}

/**
 * The per-call options `useCommand` takes.
 *
 * @category Commands
 */
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
 * type in this file. `Args`/`Reply` come from the generated command map when
 * the hook was given a known `CommandId`, and `Reply` falls back to
 * {@link AnyCommandReply} rather than to `unknown`, for the reason that type
 * gives.
 *
 * `send` is a method rather than a property holding a function for the reason
 * the spine's copy gives: as a property, `strictFunctionTypes` checks the
 * parameter contravariantly and a typed handle stops being assignable to the
 * bare `UseCommandResult` that `<CommandDelay handle>` takes.
 *
 * @category Commands
 */
export interface UseCommandResult<Args = unknown, Reply = AnyCommandReply> {
  send(args?: Args, opts?: { label?: string; topic?: string }): Promise<Reply>;
  status: CommandStatus;
  inFlight: InFlightCommand[];
  /** What this command IS on the rail's three axes, as its owning assembly
   *  declared them; hand straight to `<CommandDelay>`, which picks a renderer
   *  from them. See the spine's `UseCommandResult.tags`. */
  tags: RailTags;
  /** Effective one-way delay under this command's vantage (0 = instant by
   *  construction, `null` = no measurable one, never 0 for that). See the
   *  spine's `UseCommandResult.effectiveDelaySeconds`. */
  effectiveDelaySeconds: number | null;
  /** The one-way delay as the reading it arrived in, so a delay figure drawn
   *  through `<Unit>` draws held while `comms.delay` is quiet; `null` for an
   *  instant command. See the spine's `UseCommandResult.delayReading`. */
  delayReading: Reading<Value<"s">> | null;
  /** What `comms.delay` says the link is doing; `null` when no reading has
   *  arrived, which is not the same as `"no-path"`. See the spine's
   *  `UseCommandResult.delayMode`. */
  delayMode: DelayMode | null;
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
  /** Dispatches from this hook that were called lost and then ANSWERED after
   *  all, until dismissed. An entry here has left `losses`. See the spine's
   *  `UseCommandResult.founds`. */
  founds: CommandFound[];
  /** Dispatches from this hook that NEVER LEFT this machine, until dismissed.
   *  An entry here has left `losses` too, and unlike a loss it is safe to send
   *  again. See the spine's `UseCommandResult.undelivered`. */
  undelivered: CommandUndelivered[];
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
 *
 * @category Commands
 */
export type UseCommandResultFor<Command extends CommandId> = UseCommandResult<
  CommandArgs<Command>,
  CommandReply<Command>
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
 *
 * @category Host and runtime
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
 *
 * @category Host and runtime
 */
export interface HostIceServers {
  /** What to use right now. Empty where the host is not issuing any, including the main screen. */
  current(): RTCIceServer[];
  /** Notified when the host issues a fresh set. Returns an unsubscribe. */
  onChange(cb: (servers: RTCIceServer[]) => void): () => void;
}

/**
 * What {@link useRouteCommands} answers with: the queue for one topic, and the delay mode it is under.
 *
 * @category Commands
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

/**
 * The staleness/absence status a topic (raw or derived) is in.
 *
 * @category Stream messages
 */
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
 * mask) falls back to an explicit `Payload` type argument at the call site. Each
 * overload returns an unsubscribe function, safe to call more than once.
 *
 * @category Reading telemetry
 */
export interface LateTelemetrySubscribe {
  <Topic extends TopicId>(
    topic: Topic,
    onValue: (value: TopicPayload<Topic>) => void,
  ): () => void;
  <Payload = unknown>(
    topic: string,
    onValue: (value: Payload) => void,
  ): () => void;
}
