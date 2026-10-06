// ---------------------------------------------------------------------------
// Author-facing type surface.
// before the first external Uplink is published. The published surface lock
// (`extension-api.ledger.json`) records what is exported from here, so any
// change is a declared one.
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
import type { HeldGrade, Reading } from "../reading";
import type { UplinkClientHandle } from "../spine/uplink-clients";
import type {
  TopicId,
  TopicPayload,
  WidgetChannelId,
  WidgetFieldPath,
} from "../topics";
import type { Value } from "../value";
import type { Tone } from "./tone";

/**
 * A data key a widget lists in {@link ComponentDefinition.dataRequirements},
 * such as `"vessel.altitude"`.
 *
 * @category Registering
 */
export type DataRequirement = string;

/**
 * A behaviour a widget opts into. `"gonogo-participant"` marks a widget as
 * part of the GO/NO-GO poll.
 *
 * @category Registering
 */
export type ComponentBehavior = "gonogo-participant";

/**
 * A game state a widget needs before it can show anything useful.
 * `"flight"` needs a vessel in flight; `"career"` needs a career or science
 * save. While one a widget lists is not met, the dashboard draws a notice
 * naming it in place of the widget's body.
 *
 * @category Registering
 */
export type ComponentRequirement = "flight" | "career";

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

/**
 * Props passed to every registered dashboard component.
 *
 * @category Registering
 */
export interface ComponentProps<Config = Record<string, unknown>> {
  /** This instance's saved settings. */
  config?: Config;
  /** This instance's id on the dashboard, unique among its tiles. */
  id: string;
  /** The tile's width, in grid columns. */
  w?: number;
  /** The tile's height, in grid rows. */
  h?: number;
  /** Saves new settings for this instance, as its settings dialog does. */
  onConfigChange?: (config: Config) => void;
}

/**
 * Props passed to a widget's settings form, which the app draws inside its
 * settings dialog.
 *
 * @category Registering
 */
export interface ConfigComponentProps<Config = Record<string, unknown>> {
  /** The instance's current settings. */
  config: Config;
  /** Saves the settings and closes the dialog. */
  onSave: (config: Config) => void;
}

/**
 * One value a widget cannot do without, as its tiny mode draws it.
 *
 * @category Registering
 */
export interface TinyEssential {
  /** A few letters naming the figure, drawn with it: `ΔV`, `ALT`, `CREW`. */
  label: string;
  /**
   * The figure, drawn through `<Unit>`. A whole Reading also draws whether it
   * is current; null or absent draws the null token.
   */
  value?: Value | Reading<Value> | null;
  /**
   * A short state word drawn in the figure's place and in its tone: `LOS`,
   * `ACTIVE`. The kit announces it politely whenever it changes, unless it is
   * `urgent`, and never announces a figure. A level glyph is still drawn beside it.
   */
  word?: string;
  /**
   * Whether the word is urgent now, so the kit interrupts to say it rather than
   * announcing it politely, once each time it becomes urgent or changes while
   * urgent. For a state that must interrupt, as ABORT does, and nothing softer.
   * Set it on every render, `false` while the word is ordinary, so the tile's
   * interrupting region is in the document before the word it has to say.
   */
  urgent?: boolean;
  /** Decimal places, where the unit's own default says more than the figure means. */
  decimals?: number;
  /** How alarming the figure is. Defaults to `neutral`. */
  tone?: TinyEssentialTone;
  /**
   * A stepped level glyph drawn beside the figure, `lit` of `of` bars filled:
   * a signal strength. Null `lit` draws the glyph with nothing to judge by.
   */
  level?: { lit: number | null; of: number };
  /**
   * A thin gauge bar drawn under the hero figure: where `value` sits on the
   * scale from `min` to `max`, over the scale's bands. A value past either
   * end pins to it, a held value dims its fill, and no value draws the bands
   * alone. Only the hero draws one; on a row it is ignored.
   */
  gauge?: TinyGauge;
  /**
   * A button drawn in the figure's place, for the one command the tile exists
   * to give. The widget builds it with the same hooks its body uses
   * (`useCommand`, `useActionInput`), so it and the serial binding behave at
   * every size. `value`, `word` and `level` are not drawn alongside it.
   */
  control?: TinyControl;
}

/**
 * The button a tiny essential carries, drawn by the kit as a toggle button.
 *
 * @category Registering
 */
export interface TinyControl {
  /** What the button says: `ON`, `OFF`. */
  label: string;
  /** Whether the thing it switches is on. Sets `aria-pressed` and the filled look. */
  active: boolean;
  /** Whether a press does nothing right now. */
  disabled?: boolean;
  /** The button's accessible name. */
  title: string;
  /** A tooltip saying more than the name, such as why the button is disabled. Defaults to `title`. */
  hint?: string;
  /** Called on a press. */
  onPress: () => void;
}

/**
 * The scale a tiny essential's compact gauge draws its value on.
 *
 * @category Registering
 */
export interface TinyGauge {
  min: Value;
  max: Value;
  /** Stretches of the scale drawn in a tone of their own, in order, such as a band the value must stay out of. */
  bands?: readonly { from: Value; to: Value; tone: TinyEssentialTone }[];
}

/**
 * The severity words a tiny essential is coloured by, as a kit readout's are.
 *
 * @category Registering
 */
export type TinyEssentialTone = "neutral" | "go" | "warn" | "nogo" | "info";

/**
 * What a widget shows at the tiny size: a short heading over its essential
 * values, drawn by the kit in one standard form instead of the widget's body.
 *
 * The widget's own component is not mounted while it is tiny, so a widget that
 * handles actions must bind them inside `useEssentials`, which runs in its
 * place: a {@link TinyEssential} `control` carries the button, and the hook
 * calls `useActionInput` itself so the serial binding survives the size.
 *
 * @category Registering
 */
export interface TinyMode<Config = Record<string, unknown>> {
  /** The heading at the tiny size, short enough for a two-column tile. */
  title: string;
  /**
   * A hook returning the essential values, most important first: the first is
   * drawn largest, and a tile too short for them all drops the rest from the
   * end. Called in place of the widget's component, with its props.
   */
  useEssentials: (props: ComponentProps<Config>) => readonly TinyEssential[];
  /**
   * Set by a widget that declares actions and calls `useActionInput` inside
   * `useEssentials`, so the handlers keep running at the tiny size. Registration
   * refuses a widget with actions and a tiny mode without it.
   */
  bindsActions?: boolean;
}

/**
 * What {@link registerComponent} takes: a widget and everything the dashboard
 * needs to know to place it.
 *
 * @category Registering
 */
export interface ComponentDefinition<Config = Record<string, unknown>> {
  /** Unique across every package. Prefix it with your Uplink's name. */
  id: string;
  /** The widget's name in the widget picker and its panel heading. */
  name: string;
  /** What the widget shows, in a sentence or two, for the widget picker. */
  description: string;
  /** Free-form tags for the widget picker, such as `"telemetry"` or `"control"`. The picker styles the ones it knows. */
  tags: string[];
  /** The widget itself. */
  component: ComponentType<ComponentProps<Config>>;
  /** The widget's settings form, drawn in a dialog opened from the tile's gear icon. */
  configComponent?: ComponentType<ConfigComponentProps<Config>>;
  /** Opens the settings form as soon as the widget is added to the dashboard. */
  openConfigOnAdd?: boolean;
  /** The tile size, in grid units, when the widget is added. */
  defaultSize?: { w: number; h: number };
  /**
   * The smallest tile, in grid units, the widget's own body fits. A widget with
   * no tiny mode cannot be resized below it. One with a tiny mode shows the
   * tiny form in any tile narrower or shorter than it, and can be resized down
   * to the kit-wide `TINY_SIZE`, so it must exceed `TINY_SIZE` on at least one
   * axis. Absent, the body fits from 1x1, or from 5x4 when a tiny mode is
   * declared. There is no maximum: nothing limits how large a tile may grow.
   */
  minSize?: { w: number; h: number };
  /** What the widget draws at the tiny size. Absent, it draws its own body at every size. */
  tiny?: TinyMode<Config>;
  /** On a phone, whether the widget takes the whole width or half of it. Defaults to `"full"`. */
  mobileWidth?: "full" | "half";
  /** On a phone, the widget's height in pixels. Defaults to the height of its `defaultSize`. */
  mobileHeight?: number;
  /** Data keys the widget depends on, in the flat-key form. A widget that reads Topics lists them in `channels` instead. */
  dataRequirements?: DataRequirement[];
  /**
   * Topics the widget needs. Listing one does not subscribe to it:
   * {@link useTelemetry} subscribes whether a Topic is listed or not. When the
   * Uplink that serves a listed Topic reports itself degraded or unavailable,
   * the dashboard draws that Uplink's reason in place of the widget.
   */
  channels?: readonly WidgetChannelId[];
  /**
   * Topics the widget reads but can do without. They are read exactly as
   * `channels` are; an unhealthy Uplink serving one never replaces the widget.
   */
  optionalChannels?: readonly WidgetChannelId[];
  /**
   * The fields the widget draws, when that is fewer than the Topics it lists
   * carry. Absent means it draws everything they carry. The app reads it to
   * tell which widget shows a figure; it changes nothing about what the widget
   * can read.
   */
  fields?: readonly WidgetFieldPath[];
  /** Behaviours the widget opts into. */
  behaviors?: ComponentBehavior[];
  /** The settings a new instance starts with. */
  defaultConfig?: Partial<Config>;
  /** Actions an operator can bind to a key, button or axis. Handle them with {@link useActionInput}. */
  actions?: readonly ActionDefinition[];
  /** Lets a station send this widget to the main screen. */
  pushable?: boolean;
  /** Game states the widget needs. While one is not met, the dashboard draws a notice in its place. */
  requires?: readonly ComponentRequirement[];
  /**
   * Which seats the widget may be placed at. Absent, the dashboard works it out
   * from the widget's `channels`: a widget is available everywhere unless it
   * lists a Topic about something on the ground (`spaceCenter.*`, `career.*`,
   * `recovery.*`, and `commandCentre.*` other than the command centre roster
   * and separation), which keeps it at mission control. A Topic in any other
   * Domain, including one an Uplink adds, is available aboard.
   *
   * Set it only to change that: `["mission-control"]` for a widget that should
   * stay off the pilot seat, `["pilot"]` for one that only makes sense aboard,
   * or both.
   */
  seats?: readonly Seat[];
  /** The augment slots this widget draws, by full slot id. */
  augmentSlots?: string[];
  /**
   * The contribution slots this widget draws, by full slot id. A slot id is
   * either an augment slot or a contribution slot, never both.
   */
  contributionSlots?: readonly ContributionSlotId[];
  /**
   * The id of a widget this one replaces. The dashboard shows this one in its
   * place. When two widgets replace the same one, the original stays until the
   * operator picks between them.
   */
  replaces?: string;
  /** The handle {@link defineUplinkClient} returned, naming the Uplink that registered this widget. */
  owner?: UplinkClientHandle;
}

/**
 * What {@link registerTheme} takes: a theme the operator can switch to.
 *
 * @category Registering
 */
export interface ThemeDefinition {
  /** Unique across every package. */
  id: string;
  /** The theme's name in the theme picker. */
  name: string;
  /** The theme's tokens, a `GonogoTheme` from `@ksp-gonogo/ui-kit`. */
  theme: unknown;
}

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
 * What each widget is focused on, keyed by widget id: the resource a picker
 * has selected, the body a map is showing. An augment of that widget reads it
 * with `useWidgetScope` from `@ksp-gonogo/ui-kit`, which is how an augment in
 * a slot that passes no props, such as `sections`, follows the widget.
 *
 * A widget publishes its scope with `WidgetScopeProvider` from
 * `@ksp-gonogo/ui-kit`, and declares its shape here by declaration merging.
 *
 * @category Registering
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging seam
export interface WidgetScopeRegistry {}

/**
 * The scope the widget `Widget` publishes, from {@link WidgetScopeRegistry}.
 * `never` for a widget id that publishes none, and an open record when
 * `Widget` is a plain `string`.
 *
 * @category Registering
 */
export type WidgetScope<Widget extends string> =
  Widget extends keyof WidgetScopeRegistry
    ? WidgetScopeRegistry[Widget]
    : ErasedOrNever<Widget>;

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
 * The id of a contribution slot some widget declares.
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
  /** How the badge reads. `neutral`, or no tone, is a decorative chip that takes no part in the panel's summary. */
  tone?: Tone;
  /**
   * The reading this badge's `label` and `tone` were derived from, or just its
   * grade. A grade only shows up here once the reading itself is `"held"`
   * (`Reading.grade` is unset on every other state), so a producer can pass its
   * whole reading unconditionally and only a held one changes anything.
   *
   * Held, the panel draws the grade's own word and tone in place of `label`
   * and `tone`, as it draws every held figure, so a verdict read from a Topic
   * that stopped arriving is never shown as though it were current.
   */
  held?: HeldGrade | Reading<unknown>;
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
  /** What state the fill shows. */
  tone?: Tone;
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
 * One cell of a widget's stat strip: a label, a figure, and at most one line
 * qualifying it. It is the entry of a slot a widget declares for itself, such
 * as `astronaut-complex.readouts`, rather than of a segment every widget has.
 *
 * @category Extensions
 */
export interface StatEntry {
  /** Stable id, unique within the contributing Uplink. */
  id: string;
  /** The heading over the figure; also the cell's accessible label. */
  label: string;
  /**
   * The figure, as a value carrying its own unit. The widget draws it through
   * `Unit`, scaled and labelled the same way as every other figure on the
   * screen, so a contributor never formats one.
   *
   * `null` draws the null token. Leave it out to draw {@link text} instead.
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
  /** What state the figure shows. */
  tone?: Tone;
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
 * The name of a standard contribution segment, a key of
 * {@link ComponentSlotRegistry}.
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
 * The Uplink client that contributed an entry, as {@link Contributed} carries
 * it. Every {@link UplinkClientHandle} is one.
 *
 * @category Registering
 */
export interface UplinkClientIdentity {
  /** The Uplink's id. */
  id: string;
  /** The Uplink's version. */
  version: string;
  /** The Uplink's name, as the app shows it. */
  name: string;
}

/**
 * One contributed entry as the widget drawing it receives it: the entry, with
 * the contribution and the Uplink it came from.
 *
 * @category Extensions
 */
export type Contributed<Entry> = Entry & {
  /** The id of the contribution that returned the entry, prefixed with its Uplink's id. A stable key. */
  readonly contributionId: string;
  /** The Uplink that registered the contribution. */
  readonly owner?: UplinkClientIdentity;
};

/**
 * One entry of a contribution's `deps`: a Topic id, `{ reading: topicId }`, a
 * setting of an Uplink's host mod from {@link modSettingDep}, or the handle
 * `registerProcessor` returned. {@link DepTopics} says what `compute` receives
 * for each.
 *
 * @category Extensions
 */
export type ContributionDep =
  | TopicId
  | { readonly reading: TopicId }
  | AnyModSettingDep
  | {
      readonly id: string;
      readonly __resultType?: unknown;
      readonly __carriesCurrency?: boolean;
    };

/**
 * The settings each Uplink's host mod declares, keyed by Uplink id: the type a
 * contribution's {@link ModSettingDep} is checked against. An Uplink adds its
 * own entry by declaration merging, naming each setting with the type its
 * value parses to:
 *
 * ```ts
 * declare module "@ksp-gonogo/sitrep-sdk" {
 *   interface ModSettingsRegistry {
 *     myuplink: { readonly retirementEnabled: boolean };
 *   }
 * }
 * ```
 *
 * A dep can then name only an Uplink and a setting listed here. An Uplink id
 * or a setting key nobody declared is a type error.
 *
 * @category Extensions
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging seam
export interface ModSettingsRegistry {}

/**
 * A contribution's dependency on one setting of an Uplink's host mod, built
 * with `modSettingDep`. `compute` receives it under `settings.<uplink>.<key>`,
 * as the type `ModSettingsRegistry` declares, or `undefined` until the mod has
 * listed the setting with a readable value.
 *
 * @category Extensions
 */
export interface ModSettingDep<
  Uplink extends keyof ModSettingsRegistry & string,
  Key extends keyof ModSettingsRegistry[Uplink] & string,
> {
  readonly modSetting: { readonly uplink: Uplink; readonly key: Key };
}

/**
 * Every `ModSettingDep` the registry allows: one member per declared Uplink and
 * setting pair, so an undeclared name matches none of them. `never` while no
 * Uplink has declared a setting.
 */
export type AnyModSettingDep = {
  [Uplink in keyof ModSettingsRegistry & string]: {
    [Key in keyof ModSettingsRegistry[Uplink] & string]: ModSettingDep<
      Uplink,
      Key
    >;
  }[keyof ModSettingsRegistry[Uplink] & string];
}[keyof ModSettingsRegistry & string];

/**
 * The KEY the aggregation writes one dep's value under: a Topic id under
 * itself, a reading dep under the topic it names, a Processor under its
 * owner-stamped id.
 */
type DepKey<Dependency> = Dependency extends string
  ? Dependency
  : Dependency extends { readonly reading: infer Topic extends string }
    ? Topic
    : Dependency extends {
          readonly modSetting: {
            readonly uplink: infer Uplink extends string;
            readonly key: infer Key extends string;
          };
        }
      ? `settings.${Uplink}.${Key}`
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
 * exactly: a processor whose own deps include a reading returns a `Reading`,
 * and the stored value a contribution is handed is that same reading. Typing it
 * as the bare result here would hand a contribution a reading while telling it
 * otherwise, which is the defect the brand exists to prevent.</para>
 */
type DepValue<Dependency> = Dependency extends string
  ? TopicPayload<Dependency & TopicId> | null | undefined
  : Dependency extends { readonly reading: infer Topic }
    ? Topic extends TopicId
      ? TopicPayload<Topic> | null | undefined
      : never
    : Dependency extends ModSettingDep<infer Uplink, infer Key>
      ? ModSettingsRegistry[Uplink][Key] | undefined
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
  /**
   * Room this contribution asks of its host widget. Counted only while it
   * renders: in the highest `priority` band of a slot the widget declares or
   * carries, with its `requires` Domain present.
   */
  sizeDelta?: SizeDelta;
  /** Per-instance settings this contribution adds to the host widget's settings panel, stored under its `id`. */
  settings?: readonly AugmentSettingField[];
  /** Stamped by `defineUplinkClient(...).registerContribution`, never set by hand. */
  owner?: UplinkClientHandle;
}

/**
 * Any contribution, whatever slot it fills, as {@link getContributionsForSlot}
 * returns it. Its `compute` takes an open record, since the slot and `deps` it
 * was written against are not known here. Write a contribution as a
 * {@link ContributionDefinition}.
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
  /** The setting's key, unique within the augment or contribution. */
  key: string;
  /** `"boolean"` draws a toggle, `"text"` a text field and `"number"` a number field. */
  type: "boolean" | "text" | "number";
  /** What the operator reads beside the control. Defaults to the setting's key. */
  label?: string;
  /** The value before the operator sets one, and again after they clear a number field. */
  default?: boolean | string | number;
}

/**
 * One augment's or contribution's settings, as the host widget's settings
 * panel lists them. Each value is stored under `<namespace>.<key>` in the
 * widget instance's settings, so two contributors' settings with the same key
 * never collide. An Uplink that is not installed adds none.
 *
 * @category Extensions
 */
export interface NamespacedAugmentSettings {
  /** The id of the augment or contribution the settings belong to. */
  augmentId: string;
  /** The key its values are stored under: its id. */
  namespace: string;
  /** The settings, in the order the panel draws them. */
  fields: readonly AugmentSettingField[];
}

/**
 * Room an extension asks of the widget that hosts it, in grid units: how many
 * more columns and rows the host needs, over its own, for the extension's
 * content to fit.
 *
 * Whole numbers of zero or more. An extension asks for room and never gives it
 * back, so there is no negative form, and nothing here is a maximum: no widget
 * has an upper size. The requests of every extension that actually renders in
 * a widget are summed, and the total is added to the widget's `defaultSize`
 * and `minSize`. When a widget has a tiny mode its tiny size does not move, but
 * the tile size at which it stops showing the tiny form does. A tile already on
 * the dashboard never shrinks by itself when an extension leaves.
 *
 * @category Extensions
 */
export interface SizeDelta {
  /** Extra columns. */
  w?: number;
  /** Extra rows. */
  h?: number;
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
   * A caption for this augment, for a host that shows one beside the slot
   * rather than around it, such as a tab strip built from whatever is bound.
   * Unused by a slot whose host draws its own fixed chrome around the
   * component; read the slot's own doc comment on `SlotRegistry` to see
   * whether it does.
   */
  label?: string;
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
  /**
   * Room this augment asks of its host widget. Counted only while it renders:
   * bound to a slot the widget declares, with its `requires` Domain present.
   */
  sizeDelta?: SizeDelta;
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

export type { UplinkClientHandle } from "../spine/uplink-clients";

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
 * A planet pack adds or overrides an entry with `registerBody`.
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
  acquire(bodyId: string, layerId: string): BodyMask;
  get(bodyId: string, layerId: string): BodyMask | undefined;
  markDirty(bodyId: string, layerId: string): void;
  onChange(
    bodyId: string,
    layerId: string,
    listener: (mask: BodyMask) => void,
  ): () => void;
  clear(bodyId: string, layerId: string): void;
}

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
  /** The key, as passed to `subscribe`. */
  key: string;
  /** What the key carries. */
  description?: string;
}

/**
 * One field of a `DataSource`'s settings form, as `DataSource.configSchema`
 * lists it.
 *
 * @category Registering
 */
export interface ConfigField {
  /** The key the value is stored under in the config passed to `configure`. */
  key: string;
  /** What the operator reads beside the field. */
  label: string;
  /** Whether the field takes text or a number. */
  type: "text" | "number";
  /** Shown in the empty field. */
  placeholder?: string;
}

/**
 * A connection to something outside the game's telemetry stream, which the
 * app lists under Settings, Data Sources, with its status and a settings form
 * built from {@link DataSource.configSchema}. Register one with
 * {@link registerDataSource}.
 *
 * @category Registering
 */
export interface DataSource<
  Config extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Unique across every registered source. */
  id: string;
  /** The source's name in the Data Sources list. */
  name: string;
  /** Opens the connection. */
  connect(): Promise<void>;
  /** Closes the connection. */
  disconnect(): void;
  /** The connection's state now. */
  status: DataSourceStatus;
  /** The keys the source offers. */
  schema(): DataKey[];
  /** Calls `cb` with each new value of the key. Returns the function that stops it. */
  subscribe(key: string, cb: (value: unknown) => void): () => void;
  /** Calls `cb` whenever `status` changes. Returns the function that stops it. */
  onStatusChange(cb: (status: DataSourceStatus) => void): () => void;
  /** The fields of the source's settings form. */
  configSchema(): ConfigField[];
  /** Applies settings from the form, keyed as {@link ConfigField} names them. */
  configure(config: Record<string, unknown>): void;
  /** The settings the source is using now. */
  getConfig(): Config;
  /** Text telling the operator how to set the source up, or `null` for none. */
  setupInstructions?(): string | null;
  /**
   * When true, the app drops this source's values while the vessel has no
   * link home. Leave it unset for a source that runs on its own and handles
   * signal loss itself.
   */
  affectedBySignalLoss?: boolean;
}

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
 * The connection to the telemetry stream, for code outside a React component:
 * subscribe to a Topic, read its latest value, and send a command. Get one
 * with {@link getActiveTelemetryClient} or {@link useTelemetryClientOptional}.
 *
 * Values here are the latest received, with no state and no delay applied. A
 * widget reads with {@link useTelemetry} and sends with {@link useCommand}
 * instead.
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

//
// Same leaf constraint as `TelemetryClient` above: `DelayClockLike` is owned
// by `@ksp-gonogo/sitrep-client` (packages/sitrep-client/src/media/
// delayed-playout-buffer.ts), which the sdk cannot depend on either. Mirrors
// the minimal two-method structural contract a camera Uplink's delayed-media
// pipeline needs off the one delay authority (`ViewClock` satisfies this
// structurally): kept honest by
// `packages/core/src/sdk-facade.conformance.test-d.ts`.

/**
 * The two clock methods a delayed media player needs: the latest instant that
 * may be shown, and a per-frame callback. The view clock from
 * {@link useViewClock} satisfies it.
 *
 * @category Delay and vantage
 */
export interface DelayClockLike {
  /**
   * The latest UT, in seconds, that may be shown: a frame stamped at or before
   * it can be released. The signal delay is already applied, so do not
   * subtract it again.
   */
  confirmedEdgeUt(): number;
  /**
   * Calls `cb` with the view UT on each frame, and returns a function that
   * unsubscribes. Optional to use: a caller may instead release media on its
   * own schedule by reading `confirmedEdgeUt`.
   */
  onFrame(cb: (viewUt: number) => void): () => void;
}

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
  oneWaySeconds: number | null;
  reachEtaSeconds: number | null;
  replyEtaSeconds: number | null;
  predictedPhase: PredictedPhase;
}

/**
 * Options for {@link useCommand}.
 *
 * @category Commands
 */
export interface UseCommandOptions {
  /**
   * The command centre this command is sent from, which sets its signal delay.
   * Omit it to send from the screen's selected centre. Pass `"meta"` for a
   * command about the space program rather than a craft (research, strategies,
   * contracts), which arrives at once from any centre.
   */
  vantage?: string;
  /**
   * `false` keeps this command off the panel's delay rail, for a widget that
   * shows the command's progress itself. Otherwise the handle joins the
   * nearest rail, and a development build throws when it sends with no rail
   * mounted.
   */
  rail?: false;
}

/**
 * The handle {@link useCommand} returns: `send` to dispatch the command, and
 * what is known about it while it travels and after it ends.
 *
 * `Args` and `Reply` are the command's own argument and reply types when the
 * hook was given a {@link CommandId}. Otherwise `Args` is `unknown` and `Reply`
 * is {@link AnyCommandReply}. Pass the whole handle to `<CommandDelay>` to show
 * its delay and outcomes.
 *
 * The lists `refusals`, `losses`, `founds` and `undelivered` each hold a
 * dispatch until it is dismissed with `dismiss`, and a dispatch is in at most
 * one of them at a time.
 *
 * @category Commands
 */
// `send` is a method, not a function-valued property, so a typed handle stays assignable to the bare UseCommandResult under strictFunctionTypes.
export interface UseCommandResult<Args = unknown, Reply = AnyCommandReply> {
  /**
   * Sends the command. Resolves with the reply once the command has run.
   * Rejects when the game refuses it, with a `CommandErrorCode` to branch on
   * (see {@link classifyCommandRejection}), and when no reply arrives by the
   * expected time. A refusal or loss from a `send` whose promise nobody awaits
   * is still recorded in `refusals` or `losses`.
   *
   * `opts.label` is a description of this dispatch to show the player.
   * `opts.topic` addresses the command to one part or route on the craft.
   */
  send(args?: Args, opts?: { label?: string; topic?: string }): Promise<Reply>;
  /** The state of the latest dispatch. See {@link CommandStatus}. */
  status: CommandStatus;
  /**
   * Every dispatch from this handle still travelling or awaiting its reply. An
   * entry that is overdue or lost stays until dismissed.
   */
  inFlight: InFlightCommand[];
  /**
   * How the command travels, as its Uplink declared it. `<CommandDelay>`
   * chooses how to draw the command from these.
   */
  tags: RailTags;
  /**
   * The one-way signal delay this command will take, in seconds. `0` for a
   * command that arrives at once: one about the game clock, such as time warp,
   * or one sent with the `"meta"` vantage. `null` when no delay can be measured, such as when
   * there is no path to the craft or no `comms.delay` reading yet: never `0`
   * for those. {@link UseCommandResult.delayMode} says which.
   */
  effectiveDelaySeconds: number | null;
  /**
   * The same one-way delay as a reading, so a figure drawn from it shows as
   * held when `comms.delay` stops updating. `null` for a command that arrives
   * at once, and wherever `effectiveDelaySeconds` is `null`.
   */
  delayReading: Reading<Value<"s">> | null;
  /**
   * What the link to the craft is doing, from `comms.delay`. `null` until a
   * `comms.delay` reading arrives, which is not the same as `"no-path"`. It
   * does not stop `send`: a command sent with no path is reported in `losses`.
   */
  delayMode: DelayMode | null;
  /**
   * Removes the dispatch with this id from `inFlight`, `refusals`, `losses`,
   * `founds` or `undelivered`. Dismissing it anywhere, such as from the
   * panel's delay rail, removes it here too.
   */
  dismiss: (id: string) => void;
  /** Dispatches the game refused, newest last, each with its reason. */
  refusals: CommandRefusal[];
  /**
   * Dispatches that got no reply, newest last. The command may still have
   * run, so sending it again may run it twice.
   */
  losses: CommandLoss[];
  /**
   * Dispatches that were listed in `losses` and then got a reply after all,
   * newest last, with what the reply said.
   */
  founds: CommandFound[];
  /**
   * Dispatches that never left this machine because the link did not come
   * back, newest last. None of them ran, so each is safe to send again.
   */
  undelivered: CommandUndelivered[];
  /**
   * Whether the command can be sent right now, as the mod reports it before
   * anything is pressed, with the reason when it cannot. While it is blocked,
   * `send` refuses at once with that reason. `undefined` when nothing is
   * known in advance.
   */
  gate?: CommandGateStatus;
  /**
   * The same as `gate`, for a call with these arguments: where the mod
   * reports per item (one building, one tech node), the report for the item
   * `args` names.
   */
  gateFor(args: Args): CommandGateStatus | undefined;
}

/**
 * The handle {@link useCommand} returns for a named command, with its argument
 * and reply types. Use it to type a prop or a parameter that passes a handle
 * on, so the handle keeps its types.
 *
 * It accepts a union of ids, for commands that take the same arguments, and
 * works for an Uplink's own commands once it has augmented
 * {@link CommandArgsMap}.
 *
 * @example
 * ```tsx
 * function SasOn({ handle }: { handle: UseCommandResultFor<"vessel.control.setSas"> }) {
 *   return <Button onClick={() => void handle.send({ enabled: true })}>SAS on</Button>;
 * }
 * ```
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
 * What a station hands an Uplink's non-React code: the same two routes
 * `useUplinkRelay` and `useHostIceServers` give a widget, bound to that Uplink.
 *
 * `relay` reaches the Uplink's registered handle on the main screen, which is
 * the only thing a station talks to. `iceServers` carries the TURN credentials
 * the main screen broadcasts, for a media connection the Uplink opens from the
 * station itself.
 *
 * @category Host and runtime
 */
export interface StationBroker {
  relay: UplinkRelay;
  iceServers: HostIceServers;
}

/**
 * Called on a station for the Uplink that registered it, once per station
 * screen that comes up.
 *
 * @category Host and runtime
 */
export type StationBrokerAttach = (broker: StationBroker) => void;

/**
 * What {@link useRouteCommands} returns.
 *
 * @category Commands
 */
export interface UseRouteCommandsResult {
  /** Every command travelling to the topic, from any command centre. */
  items: InFlightCommand[];
  /** What the link the commands travel on is doing. */
  mode: DelayMode;
}

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
  | "held"
  | "disconnected"
  | "last-before-blackout"
  | "recorded"
  | "loading"
  | "no-game"
  | "absent"
  | "resyncing";

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
 * The subscribe function {@link useLateTelemetrySubscribe} returns. Call it
 * with a Topic and a callback; it returns a function that unsubscribes and is
 * safe to call more than once.
 *
 * A {@link TopicId} gives the callback that Topic's payload type. For a Topic
 * id built at runtime, pass the payload type yourself:
 * `subscribe<MyPayload>(topic, onValue)`.
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
