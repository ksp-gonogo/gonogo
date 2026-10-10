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
  DelayMode,
  InFlightCommand,
  PredictedPhase,
} from "../command-delay";
import type {
  AnyCommandReply,
  CommandArgs,
  CommandId,
  CommandReply,
} from "../commands";
import type { RailTags } from "../rail-tags";
import type { HeldGrade, Reading, TopicCurrency } from "../reading";
import type { UplinkClientHandle } from "../spine/uplink-clients";
import type {
  ChannelFamily,
  TopicId,
  TopicPayload,
  WidgetChannelId,
  WidgetFieldPath,
} from "../topics";
import type { Value } from "../value";
import type { Tone } from "./tone";

/**
 * A data key a widget lists in {@link ComponentDefinition.dataRequirements},
 * in the older flat-key form that names one value per key, such as
 * `"v.altitude"`. A widget that reads Topics lists them in `channels` instead.
 *
 * @category Registering
 */
export type DataRequirement = string;

/**
 * A behaviour a widget opts into. `"gonogo-participant"` is the only one and
 * has no effect: the GO/NO-GO poll is a vote the operators take, and nothing a
 * widget does feeds it.
 *
 * @category Registering
 */
export type ComponentBehavior = "gonogo-participant";

/**
 * A game state a widget needs before it can show anything useful.
 * `"flight"` needs a vessel in flight; `"career"` needs a career save or a
 * science-mode save (KSP's mode with science but no funds). While one a widget lists is not met, the dashboard draws a notice
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
  /** Which kind of input fired. */
  kind: ActionInputKind;
  /** For a button, `true` when pressed and `false` when released; for an axis, from -1 to 1. */
  value: boolean | number;
  /** The device's own value, before it was turned into the pressed flag or the -1 to 1 of `value`, if the handler wants it. */
  raw?: unknown;
}

/**
 * One action a widget declares in {@link ComponentDefinition.actions}, which
 * an operator can bind to a key, button or axis.
 *
 * @category Actions
 * @categoryDescription Actions
 * The things a widget can be told to do from outside its own controls: the
 * actions it declares, the handlers that carry them out, and the payload an
 * operator's key, button or analog input arrives with. Read here to make a
 * widget drivable from a keyboard or a physical panel.
 *
 * @concept Action and binding
 * An action is something a widget can be told to do by an input the operator
 * holds, such as a key, a controller button or an analog axis. The widget
 * declares its actions in {@link ComponentDefinition.actions}, each an
 * {@link ActionDefinition} saying which kinds of input
 * ({@link ActionInputKind}) may drive it, and handles them with
 * {@link useActionInput}.
 *
 * A binding connects one input of one device to one action of one placed
 * widget. The operator makes it on the widget's Inputs tab, and it is saved
 * with that widget. A device belongs to the screen it is plugged into, and its
 * inputs never reach another screen. The keyboard is always present, so any
 * action can be bound to a key.
 *
 * - an action is not a command: an action runs the widget's own handler on this
 *   screen. Whatever that handler sends to the game goes through
 *   {@link useCommand} and its delay like any other command
 * - an action is not a binding: the widget owns the action and its id, and the
 *   operator owns the binding. Keep an action's id stable, because saved
 *   bindings refer to it
 *
 * A handler receives an {@link ActionInputPayload}, and what it returns is sent
 * back to the device that fired it, for a control panel with a display of its
 * own.
 */
export interface ActionDefinition {
  /** The action's id, unique within the widget. Saved input bindings refer to it, so keep it stable. Ids are kebab-case, such as `toggle-follow`. */
  id: string;
  /** The action's name, shown where the operator binds inputs. */
  label: string;
  /** Which input kinds may drive this action. */
  accepts: readonly ActionInputKind[];
  /** A longer description, shown where the operator binds inputs. */
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
 * How a {@link TinyEssential}'s figure is marked where its Reading cannot say.
 *
 * @category Registering
 */
export interface TinyEssentialMark {
  /** How current the figure is: `held`, the last value received, or `modelled`, an estimate carried forward from it. A current reading when omitted. */
  kind?: "held" | "modelled";
  /** The figure is of something other than what its label names. */
  elsewhere?: boolean;
  /** What the mark means, spoken after the figure and shown on hover. */
  caption: string;
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
   * The figure, drawn as ui-kit's `Unit` draws one. A whole Reading also draws whether it
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
   * Set it on every render, `false` while the word is ordinary: a screen
   * reader interrupts reliably only when the place it speaks from was already
   * on the page before the urgent word arrived.
   */
  urgent?: boolean;
  /** Decimal places, where the unit's own default says more than the figure means. */
  decimals?: number;
  /**
   * What the figure is where the Reading in `value` cannot say it, drawn with
   * the marks a full readout uses. `kind` is how current it is: `held` or
   * `modelled`, and a current reading when omitted. `elsewhere` says the figure
   * is of something other than the label names (a strength measured on
   * another route), which draws the mark hollow. A `value` that is itself a
   * held or modelled Reading keeps that kind, and `elsewhere` still applies.
   * `caption` says it in words: it is spoken after the figure and shown on
   * hover. Ignored beside a `word`.
   */
  mark?: TinyEssentialMark;
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
  /** The value at the empty end of the gauge. */
  min: Value;
  /** The value at the full end of the gauge, in the same unit as `min`. */
  max: Value;
  /** Stretches of the scale drawn in a tone of their own, in order, such as a band the value must stay out of. */
  bands?: readonly { from: Value; to: Value; tone: TinyEssentialTone }[];
}

/**
 * The severity words a tiny essential is coloured by: {@link Tone} without
 * `caution` and `offline`.
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
  /** Unique across every package, and used exactly as written, so prefix it with your Uplink's name yourself (`foo-status`). */
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
  /** Data keys the widget depends on, in the older flat-key form that names one value per key, such as `"v.altitude"`. A widget that reads Topics lists them in `channels` instead. */
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
   * Families of Topics the widget needs whose ids are built at runtime, such as
   * `"fleet.<vessel>.contact"`. They are claimed and health-checked like
   * `channels`, by the literal prefix before the first placeholder (a family
   * that starts with a placeholder has none, so it is neither claimed nor
   * health-checked). A family with no members yet is not a failure. They do not
   * feed the blackout badge, because blackout is per craft.
   */
  channelFamilies?: readonly ChannelFamily[];
  /**
   * Families of Topics the widget reads but can do without, such as
   * `"vessel.partActions.<flightId>"`. They are read as `optionalChannels` are
   * and never replace the widget.
   */
  optionalChannelFamilies?: readonly ChannelFamily[];
  /**
   * Topics the widget reads that depend on how the tile is set up, such as the
   * series a graph plots, as concrete Topic ids. They count as optional
   * channels: claimed with the lock scope, counted for the "No telemetry host"
   * placeholder, shown on the blackout badge and matched by alarms, but an
   * unhealthy Uplink serving one never replaces the widget.
   */
  channelsFromConfig?: (config: Config) => readonly string[];
  /**
   * The commands the widget's controls can send. A command is a request that
   * changes the game or the dashboard, sent through {@link useCommand} (staging
   * a maneuver node, setting a warp rate, accepting a contract). List every one
   * a control of the widget can send, not only the ones a default tile shows.
   *
   * It is documentation and a checked promise: the widget's reference page
   * lists these as what its controls do, and the repository's tests fail when a
   * widget sends a command it does not list or lists one it never sends. It
   * does not lock or replace the widget the way a required channel does.
   */
  commands?: readonly CommandId[];
  /**
   * The fields the widget draws, when that is fewer than the Topics it lists
   * carry. Absent means it draws everything they carry. The app reads it to
   * tell which widget shows a figure; it changes nothing about what the widget
   * can read.
   */
  fields?: readonly WidgetFieldPath[];
  /** Behaviours the widget opts into; see {@link ComponentBehavior}. The only one has no effect, so leave this out. */
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
  /**
   * The augment slots this widget draws, by full slot id, each declared in
   * {@link SlotRegistry}. A slot id nothing declares does not compile.
   */
  augmentSlots?: readonly SlotId[];
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
  /** The theme's tokens: a `UiKitTheme`, the type `@ksp-gonogo/ui-kit` exports. */
  theme: unknown;
}

/**
 * Every augment slot, keyed by slot id, mapped to the props the slot passes its
 * augments. An augment is a React component an Uplink binds to a slot with
 * `registerAugment`; the widget renders it in place.
 *
 * A widget that owns a slot declares it here by declaration merging, so an
 * augment of a misspelled slot does not typecheck. The two standard segments
 * every widget's panel carries, `<widget-id>.sections` and
 * `<widget-id>.actions`, are typed by ui-kit's `AugmentSegmentRegistry`
 * instead, though a widget may also name its own here.
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
 * `@ksp-gonogo/ui-kit`, and declares its shape here by declaration merging,
 * in the widget's own package:
 *
 * ```ts
 * declare module "@ksp-gonogo/sitrep-sdk" {
 *   interface WidgetScopeRegistry {
 *     "my-widget": { selectedResource: string | undefined };
 *   }
 * }
 * ```
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
 * One badge on a widget's panel header: the entry of the `badges` segment of
 * {@link ComponentSlotRegistry}, which is the slot `<widget id>.badges`.
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
   * When the reading is held, the panel draws the grade's own word and tone in place of `label`
   * and `tone`, as it draws every held figure, so a verdict read from a Topic
   * that stopped arriving is never shown as though it were current.
   */
  held?: HeldGrade | Reading<unknown>;
}

/**
 * One labelled bar in a widget's meter list: the entry of the `meters`
 * segment of {@link ComponentSlotRegistry}, which is the slot
 * `<widget id>.meters`. The widget draws it with ui-kit's `Meter`.
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
   * renders a list: a kerbal's name, a part id. Leave it out for a meter
   * about the whole widget, in a slot that draws those. A slot that draws
   * meters only beside rows, as `crew-status.meters` does, draws nothing for
   * an entry with no `row`.
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
   * A whole `Reading` is drawn marked when it is held.
   */
  value?: Value | Reading<Value> | null;
  /**
   * The figure when it is NOT a quantity: an occupancy ("3 / 13"), a name, a
   * bare count of things that carry no unit. Ignored when {@link value} is
   * given, which is the one that gets unit rendering.
   */
  text?: string;
  /**
   * The reading {@link text} was drawn from, or just its grade. Only a held
   * reading changes anything, so it can be passed unconditionally; while it is
   * held the text is drawn with the held mark. A `value` carries its own
   * reading instead.
   */
  held?: HeldGrade | Reading<unknown>;
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
 * Of these contribution segments, only `badges` is on every widget. `filters`
 * and `meters` exist on a widget only where it renders the component that
 * draws them. A widget drawn in ui-kit's `Panel` also carries two augment
 * slots, `sections` and `actions`, which are not contribution segments and so
 * are not listed here.
 *
 * @category Extensions
 */
export interface ComponentSlotRegistry {
  /**
   * A pre-filled search term, drawn as a toggle by a widget that shows a
   * `FilterList`.
   */
  filters: string;
  /** A badge on the widget's panel header. Every widget carries the slot, and a contribution to it returns as many badges as it has to show. */
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
 * Read the type as three cases in turn. A slot id a widget declares in
 * `ContributionRegistry` gives the entry it declares there. Otherwise, a slot
 * id ending in a segment every widget carries (`<widget-id>.badges`) gives
 * that segment's entry from `ComponentSlotRegistry`. Any other named slot id
 * has no entry type, so a contribution to it does not compile; a slot typed as
 * a plain `string` gives an open record.
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
 * One entry of a contribution's `deps`: a Topic id, a setting of an Uplink's
 * host mod from {@link modSettingDep}, or the handle
 * {@link UplinkClientHandle.registerProcessor} returned for a processor whose
 * result is a `Reading`. {@link DepTopics} says what `compute` receives for
 * each.
 *
 * A processor handle is accepted only when its result carries currency, which
 * it does when one of its own deps is a `{ reading: topicId }`: a bare result
 * computed from Topics would reach the contribution with nothing saying
 * whether those Topics were held.
 *
 * @category Extensions
 */
export type ContributionDep =
  | TopicId
  | AnyModSettingDep
  | {
      readonly id: string;
      readonly __resultType?: unknown;
      readonly __carriesCurrency?: true;
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
 *     "myuplink": { readonly difficulty: number };
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
  /** The Uplink, by its id, and the key of the host mod's setting to read, as `ModSettingsRegistry` declares them. */
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
 * itself, a Processor under its owner-stamped id.
 */
type DepKey<Dependency> = Dependency extends string
  ? Dependency
  : Dependency extends {
        readonly modSetting: {
          readonly uplink: infer Uplink extends string;
          readonly key: infer Key extends string;
        };
      }
    ? `settings.${Uplink}.${Key}`
    : Dependency extends { readonly id: infer ProcessorId extends string }
      ? /*
         * A processor whose id is still the unnarrowed `string` contributes NO
         * key. It would otherwise contribute a string index signature, which
         * reopens every key on the record: one loosely-typed dep would make an
         * undeclared topic readable again for that whole contribution. A handle
         * from `defineProcessor`/`registerProcessor` always carries its stamped
         * id; one from `defineProcessorContract` only does when the caller
         * names it.
         */
        string extends ProcessorId
        ? never
        : ProcessorId
      : never;

/**
 * The VALUE that arrives under that key.
 *
 * <para>A Topic arrives as its reading, so a contribution can tell a current
 * value from a held one and draw each as what it is. `"pending"` is no point
 * yet, `"absent"` is the mod saying there is nothing to describe, and only
 * `"observed"` and `"held"` carry a value, reached through `value` once the
 * state says there is one. The reading carries no forward model (`reckoning`
 * is always `{ status: "none" }`) and no per-field readings; a contribution
 * that wants a modelled figure depends on a processor with a `{ reading }`
 * dep, which is handed the whole reading.</para>
 *
 * <para>A PROCESSOR dep tracks the evaluator exactly: a processor whose own
 * deps include a reading returns a `Reading`, dated by those inputs, and that
 * is the value a contribution is handed.</para>
 */
type DepValue<Dependency> = Dependency extends string
  ? TopicCurrency<
      TopicPayload<Dependency & TopicId>,
      { readonly status: "none" }
    >
  : Dependency extends ModSettingDep<infer Uplink, infer Key>
    ? ModSettingsRegistry[Uplink][Key] | undefined
    : Dependency extends {
          readonly id: string;
          readonly __resultType?: infer Result;
        }
      ? Reading<Result> | undefined
      : never;

/**
 * The argument a contribution's `compute` receives: the reading of each Topic
 * named in its `deps`, keyed by the Topic's id and typed by its payload. A
 * Topic not named in `deps` cannot be read.
 *
 * A reading is `"pending"` until the Topic's first sample arrives, and
 * `"absent"` while the mod reports that it has nothing to describe. When
 * samples stop it turns `"held"`, keeping the last value with the instant it
 * was observed, so a value drawn from it can be marked as held.
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
 * - `compute` receives one object holding the reading of every Topic named in
 *   `deps` by any contribution to the slot, all read at the same instant: the
 *   instant the dashboard is showing, so under signal delay they lag as every
 *   widget does. The same object is passed to every contribution to the slot.
 * - A reading is `"pending"` until its Topic's first sample arrives, and
 *   `"absent"` while the mod reports that it has nothing to describe. When
 *   samples stop or the link drops it turns `"held"`: the last value, with when
 *   it was observed and why it stopped. An entry drawn from a held value must
 *   say so, through the entry's own reading or `held` field, so the widget
 *   draws it as held rather than as current.
 * - The Topics are read at most once per animation frame. A reading stays the
 *   same object until a new sample of it is shown or its state changes, and a
 *   Topic the mod sends directly gives a new reading for every sample, even
 *   one identical to the last. When several samples arrive within one frame, `compute` sees only
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
   * to it, and `compute` receives each one's reading, typed by its payload; a
   * Topic left out cannot be read.
   */
  deps?: Deps;
  /**
   * Returns this contribution's entries for the slot, or `null` for none. It
   * must return them directly, not through a promise, and it runs again
   * whenever a Topic the slot reads changes.
   *
   * A reading that is not `"observed"` or `"held"` has no value to draw, so
   * return no entries for it rather than a zero, an empty count or a nominal
   * state. A held value is drawn as held, never as current.
   */
  compute: (
    topics: DepTopics<Deps>,
  ) => readonly ContributionEntry<Slot>[] | null | undefined;
  /**
   * A Domain id. `compute` runs only while that Domain is present; while it is
   * not, the contribution draws nothing. A Domain is present from the first
   * value its `<domain>.available` Topic delivers, so naming `"example"` here
   * needs a plugin that declares and publishes `example.available`. Leave it
   * out when `deps` already says everything: with no value for a dep, `compute`
   * is handed none and can return nothing.
   */
  requires?: string;
  /**
   * Which band this contribution belongs to. Only the highest band present in
   * a slot renders, and every contribution in it renders, in registration
   * order. A widget filling its own slot sits at 0, so a contribution at the
   * default replaces the widget's own entries rather than appearing beside
   * them. Set `0` to add to what the widget draws rather than replace it.
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
 * and `minSize`. When a widget has a tiny mode (the compact form it draws at
 * {@link TINY_SIZE}, showing only its essentials), its tiny size does not
 * move, but the tile size at which it stops showing the tiny form does. A tile already on
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
 *
 * @concept Augment, contribution and slot
 * A slot is a named place a widget opens to other Uplinks,
 * `<componentId>.<segment>`, such as `"crew-status.badges"`. A widget lists the
 * slots it draws in {@link ComponentDefinition.augmentSlots} and
 * {@link ComponentDefinition.contributionSlots}, and every widget drawn in a
 * Panel carries a sections, an actions and a badges slot without declaring
 * them. An Uplink fills a slot in one of two ways, and the two are not
 * interchangeable:
 *
 * - an augment draws: it is a component, registered with
 *   {@link registerAugment} as an {@link AugmentDefinition}, that the widget
 *   renders as a child where it places the slot. It receives the slot's props
 *   ({@link SlotProps}) and reads any Topic it needs with {@link useTelemetry},
 *   as a widget does
 * - a contribution hands over data and never draws: it is a
 *   {@link ContributionDefinition} whose `compute` receives the readings of the
 *   Topics it names in `deps` and returns entries, which the widget draws in
 *   its own style. An entry drawn from a held reading carries that reading, so
 *   the widget draws it as held. Only the highest priority band registered to a
 *   slot runs
 *
 * Both may name a Domain in `requires` and then appear only while that Domain
 * is present. {@link SlotRegistry} and {@link ContributionSlotId} type the slot
 * ids, so a misspelled slot does not compile.
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
   * present, so it stays hidden while its mod is not running. A Domain is
   * present from the first value its `<domain>.available` Topic delivers, so
   * naming `"example"` here needs a plugin that declares and publishes
   * `example.available`. An augment whose Uplink publishes no such Topic
   * leaves this out and returns nothing until its own Topic has a value.
   */
  requires?: string;
  /**
   * Order among the augments in one slot, lowest first; ties render in
   * registration order. Every augment in a slot renders: unlike a
   * contribution's `priority`, this only orders them.
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
 * What {@link registerCoverageSource} takes: one layer of map coverage, such as
 * a scanner's. The source writes its coverage into the
 * {@link CoverageMaskCache} under its own `id` as the layer id, and the map
 * reveals each cell as far as the most revealing source allows.
 *
 * @category Maps and coverage
 */
export interface CoverageSourceDefinition {
  /** Unique across every source. Also the layer id the source's masks are stored under. */
  id: string;
  /** A readable name for the source, for your own code: the map does not draw it. */
  label?: string;
  /** How fully a covered cell is revealed, from 0 to 255. Defaults to 255, fully. */
  weight?: number;
  /** Settings the source adds to the map's settings panel. A boolean `show` set to `false` hides the source's coverage. */
  settings?: readonly AugmentSettingField[];
}

/**
 * One button on a {@link MapPoi}'s card.
 *
 * @category Maps and coverage
 */
export interface MapPoiAction {
  /** Unique within the point. */
  id: string;
  /** The button's text. */
  label: string;
  /** Called when the button is pressed. */
  run: () => void | Promise<void>;
  /** Whether the button is disabled. */
  disabled?: boolean;
  /** Why the button is disabled, shown in place of `label` while it is. */
  disabledReason?: string;
}

/**
 * One point of interest a {@link MapPoiProviderDefinition} puts on the map.
 *
 * @category Maps and coverage
 */
export interface MapPoi {
  /** Unique among the provider's points. */
  id: string;
  /** The body the point is on. A body's id is its name, such as `"Kerbin"`, here and everywhere a body id appears. */
  bodyId: string;
  /** Latitude, in degrees. */
  lat: number;
  /** Longitude, in degrees. */
  lon: number;
  /** What the point is. The map has its own marker for `"ksc"`, `"launchSite"`, `"anomaly"` and `"contractTarget"`; any other kind gets a plain one. */
  kind: string;
  /** The point's name, on its marker and card. */
  label: string;
  /** One more line on the point's card. */
  detail?: string;
  /**
   * For a `"contractTarget"`, whether the contract is `"active"` or
   * `"available"`. `"info"` is accepted and drawn the same as `"available"`.
   * Ignored for every other kind.
   */
  status?: "active" | "available" | "info";
  /** Extra details, each shown on the point's card as a row of key and value. */
  meta?: Record<string, unknown>;
  /** Buttons on the point's card. */
  actions?: readonly MapPoiAction[];
}

/**
 * What a point-of-interest provider is told about the map asking for points.
 *
 * @category Maps and coverage
 */
export interface MapPoiProviderContext {
  /** The id (its name, such as `"Kerbin"`) of the body the map is showing, or `undefined` before one is chosen. */
  bodyId: string | undefined;
}

/**
 * A point-of-interest provider's hook, called on every render of the map. It
 * may use other hooks.
 *
 * @category Maps and coverage
 */
export type UseMapPois = (
  ctx: MapPoiProviderContext,
) => readonly MapPoi[] | null | undefined;

/**
 * What {@link registerMapPoiProvider} takes: a source of points of interest for
 * the body the map shows. The map draws, labels and offers the actions of
 * every provider's points the same way.
 *
 * @category Maps and coverage
 */
export interface MapPoiProviderDefinition {
  /** `<uplinkId>:<name>`, such as `"example-uplink:anomalies"`. */
  id: string;
  /** A Domain id. The provider's points show only while that Domain is present. */
  requires?: string;
  /** The hook that returns the points. */
  usePois: UseMapPois;
}

/**
 * How a body's surface texture maps latitude and longitude to pixels. It is
 * the `map` field of a {@link BodyDefinition}.
 *
 * @category Maps and coverage
 */
export interface BodyMapConfig {
  /** The projection: always equirectangular, longitude across and latitude down. */
  type: "equirectangular";
  /** Pixel width of the source texture image. */
  width: number;
  /** Pixel height of the source texture image. */
  height: number;
}

/**
 * An atmosphere as pressure falling exponentially with height, from a surface
 * pressure and a scale height. KSP's real atmospheres are not quite
 * exponential, so use it to draw a pressure curve or compare atmospheres, not
 * to compute flight.
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
 * A celestial body for maps and diagrams: its size, look and imaging limits.
 * Register one with {@link registerBody}; a planet pack registers its own to
 * replace stock ones.
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
  /** Whether the body has an atmosphere. */
  hasAtmosphere: boolean;
  /** How high the atmosphere reaches, metres above sea level. */
  maxAtmosphere: number;
  /** Optional atmosphere model. Only meaningful when `hasAtmosphere` is true. */
  atmosphere?: AtmosphereModel;
  /**
   * Representative sky/haze colour, for tinting an atmospheric readout. Only
   * meaningful when `hasAtmosphere` is true; leave unset for airless bodies so
   * consumers fall back to a neutral default.
   */
  atmosphereColor?: string;
  /**
   * The colour of the body's open liquid, its seas, for a body that has them:
   * a CSS colour string. A plot of a sea shades it in this colour, at its
   * theme's own brightness. Leave unset for a body with no seas, or to have
   * them drawn in the theme's water colour.
   */
  liquidColor?: string;
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
  /** The body the mask covers. */
  readonly bodyId: string;
  /** The coverage layer, a coverage source's id. */
  readonly layerId: string;
  /** Cells across, spanning 360 degrees of longitude. */
  readonly width: number;
  /** Cells down, spanning 180 degrees of latitude. */
  readonly height: number;
  /** One byte per cell, row by row: 0 is hidden and 255 fully revealed. Write into it, then call `markDirty`. */
  data: Uint8Array;
}

/**
 * The methods of the {@link CoverageMaskCache} an author calls, as
 * {@link useCoverageMaskCache} returns it.
 *
 * @category Maps and coverage
 */
export interface CoverageMaskCacheHandle {
  /** The mask for a body and layer, created with every cell hidden on first use. */
  acquire(bodyId: string, layerId: string): BodyMask;
  /** The mask for a body and layer, or `undefined` if it has not been created. */
  get(bodyId: string, layerId: string): BodyMask | undefined;
  /** Tells the mask's listeners its bytes changed. Call it after writing into `data`. */
  markDirty(bodyId: string, layerId: string): void;
  /** Calls `listener` whenever the mask changes. Returns the function that stops it. */
  onChange(
    bodyId: string,
    layerId: string,
    listener: (mask: BodyMask) => void,
  ): () => void;
  /** Hides every cell of the mask and tells its listeners. */
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
 * One registered `DataSource` as {@link useDataSources} lists it.
 *
 * @category Registering
 */
export interface DataSourceState {
  /** The source's id. */
  id: string;
  /** The source's display name. */
  name: string;
  /** Its connection state now. */
  status: DataSourceStatus;
}

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
 * Which screen a component is on. `"main"` connects to the game and hosts the
 * stations; `"station"` is fed by the main screen; `"pilot"` connects to the
 * game from aboard the craft and hosts nothing. A widget can draw differently
 * on each, as the GO/NO-GO poll does.
 *
 * @category Host and runtime
 *
 * @concept Station and main screen
 * Every page of the app is one of three screens ({@link Screen}), and which one
 * is a matter of how it is wired, not what the operator does there:
 *
 * - the main screen (`"main"`) is the one connection to the game. It reads the
 *   stream from the mod and passes it on to every station
 * - a station (`"station"`) is fed by the main screen over a peer connection
 *   and never talks to the game itself. Its layout lives in the browser it runs
 *   in
 * - the pilot screen (`"pilot"`) connects to the game from aboard the craft and
 *   passes nothing on
 *
 * A widget asks with {@link useScreen} and may draw differently on each, as a
 * GO/NO-GO poll does. The screen is not the seat: main and station screens both
 * put the operator at mission control, and only the pilot screen puts them
 * aboard ({@link Seat}, {@link seatOf}). Rules about signal delay follow the
 * seat.
 */
export type Screen = "main" | "station" | "pilot";

/**
 * Where the operator is sitting: at mission control, or aboard as the pilot.
 * Worked out from the {@link Screen}; a widget's availability and a message's
 * signal delay both depend on the seat.
 *
 * @category Host and runtime
 *
 * @concept Domain and seat
 * A Domain is a family of Topics named by the first segment of their ids, such
 * as `vessel`, `career` or an Uplink's own prefix. A Domain an Uplink adds can
 * come and go with its mod, and it counts as present from the first value its
 * `<domain>.available` Topic delivers. An augment, a contribution or a map
 * point provider that names a Domain in `requires` appears only while that
 * Domain is present.
 *
 * A seat is where the operator sits: at mission control, or aboard the craft as
 * the pilot ({@link Seat}). It is worked out from the screen ({@link seatOf}),
 * and every rule that cares about light-time is a rule about the seat, never
 * about the screen.
 *
 * The two meet in {@link ComponentDefinition.seats}, which says at which seats
 * a widget may be placed. When a widget leaves it out, the dashboard works it
 * out from the Domains of the Topics the widget lists: a widget reading a Topic
 * about the ground (the space centre, the career, recovery, and command centres
 * other than the roster and their separation) stays at mission control, and
 * every other widget, including one reading an Uplink's own Domain, is
 * available aboard as well.
 *
 * - a seat is not a screen: a pilot on a peer-fed page is on a different screen
 *   and in the same seat
 * - a Domain is not a Topic: a widget lists Topics, and its seats and an
 *   extension's presence follow from their Domains
 */
export type Seat = "mission-control" | "pilot";

/**
 * What {@link registerSettingsTab} takes: a whole tab of the app's Settings,
 * drawn by the Uplink itself.
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
  /** Which screens this tab appears on. Omit for every screen. */
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
  /** Calls `cb` with each new value of `topic`, and returns a function that unsubscribes. */
  subscribe(topic: string, cb: (value: unknown) => void): () => void;
  /** The latest value received on `topic`, or `undefined` before the first one. */
  getValue(topic: string): unknown;
  /**
   * Sends `command` with `args`. `label` is the name an operator sees for it in
   * the pending list, and `topic` the Topic it concerns. `requestId` identifies
   * this send, and `result` settles with the host's answer.
   */
  dispatch(
    command: string,
    args?: unknown,
    label?: string,
    topic?: string,
  ): { requestId: string; result: Promise<unknown> };
  /** Closes the connection and drops every subscription. */
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
 * A performance budget, as {@link createPerfBudget} returns it.
 *
 * @category Logging and performance
 */
export interface PerfBudgetHandle {
  /**
   * Counts one event against the budget, or `amount` of them. Call it wherever
   * the thing being budgeted happens, such as each sample a source emits.
   * `now` is the time in milliseconds to count it at, for a test; absent, the
   * clock's own.
   */
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
  CommandFailure,
  CommandFound,
  CommandLoss,
  CommandRefusal,
  CommandStatus,
  CommandUndelivered,
} from "../spine/lifecycle";

export type { CommandGateStatus } from "../spine/command-gate";
export type {
  CommandFailure,
  CommandFound,
  CommandFoundOutcome,
  CommandLoss,
  CommandRefusal,
  CommandRefusalDetail,
  CommandStatus,
  CommandUndelivered,
} from "../spine/lifecycle";

export type { DelayMode, InFlightCommand, PredictedPhase };

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
 * The lists `refusals`, `losses`, `founds`, `undelivered` and `failures` each hold a
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
   * `opts.label` is a description of this dispatch to show the operator.
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
   * `founds`, `undelivered` or `failures`. Dismissing it anywhere, such as from the
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
   * Dispatches the mod answered with a fault rather than a reply, newest last:
   * expired or cancelled on the way, dropped where a continuous input would
   * have waited, or undone by a game load. None of them ran.
   */
  failures: CommandFailure[];
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
 * One call to an Uplink's own method, as {@link useUplinkRelay} returns it.
 * `method` and `args` mean whatever the Uplink's registered object says they
 * mean; nothing between the caller and that object reads either.
 *
 * Rejects with an `Error` when there is no route (no object registered, or a
 * station with no link to the main screen) and when the object throws. Extra
 * properties of a thrown `Error` survive the trip, so a client can read back
 * what its own code set on it.
 *
 * @category Host and runtime
 */
export type UplinkRelay = (method: string, args?: unknown) => Promise<unknown>;

/**
 * The ICE servers the main screen hands out, as {@link useHostIceServers}
 * returns them, for an Uplink opening a media connection from a station.
 *
 * Read through functions rather than as an array because credentials rotate: a
 * connection opened before a rotation sees the new ones through `onChange`
 * without re-rendering anything.
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
  /** Calls a method of the Uplink's registered handle on the main screen and resolves with what it returns. */
  relay: UplinkRelay;
  /** The TURN and STUN servers the main screen is broadcasting, and a way to hear when they change. */
  iceServers: HostIceServers;
}

/**
 * Called on a station for the Uplink that passed it to
 * {@link registerStationBroker}, once per station screen that comes up.
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
 * How current a Topic is, as one word: `"live"`, one of the reasons it is
 * held (as in {@link HeldGrade}), `"absent"`, or `"resyncing"` after a rewind.
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
