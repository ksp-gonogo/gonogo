import { useMemo, useSyncExternalStore } from "react";
import type { Quality } from "../__generated__/contract";
import type { Tone } from "./tone";

/*
 * The mode registry lives here, not in core, because an Uplink may declare a
 * mode of its own, and its state sits in one global slot so an Uplink that
 * bundles this package still registers into the app's copy. Same reasoning as
 * `./map-poi.ts`.
 */

/**
 * Every mode the dashboard can be in, by id. A mode is what the dashboard
 * shows: `live` is the game as it is now, and the mode the dashboard is in
 * when no other is on; `design` is the craft in the vehicle editor; `replay` is a recorded
 * flight played back. Useful for naming the mode a section belongs to and the
 * mode a source answers.
 *
 * An Uplink declares its own mode by declaration merging, lists it in its
 * mod's manifest, and answers it with {@link registerModeSource}:
 *
 * ```ts
 * declare module "@ksp-gonogo/sitrep-sdk" {
 *   interface ModeRegistry {
 *     "my-uplink.sim": true;
 *   }
 * }
 * ```
 *
 * @category Modes
 */
export interface ModeRegistry {
  /** The game as it is now. On whenever no other mode is. */
  live: true;
  /** The craft in the vehicle editor and its predicted flight. */
  design: true;
  /** A recorded flight, played back. */
  replay: true;
}

/**
 * The id of a mode in {@link ModeRegistry}, such as `"replay"`. Taken
 * by {@link registerModeSource} and {@link registerMode}.
 *
 * @category Modes
 */
export type ModeId = keyof ModeRegistry & string;

/**
 * A recording's playback, for a timeline that plays one back: whether it is
 * playing, at what rate, and the controls. Part of a {@link ModeTimeline}.
 *
 * @category Modes
 */
export interface ModePlayback {
  /** True while the recording plays. */
  playing: boolean;
  /** Recorded seconds per real second. */
  rate: number;
  /** The rates the operator can pick from. */
  rates: readonly number[];
  /** Plays the recording from where it is. */
  play: () => void;
  /** Holds the recording where it is. */
  pause: () => void;
  /** Sets the recorded seconds played per real second, one of `rates`. */
  setRate: (rate: number) => void;
  /** Leaves the recording and returns to live data. */
  exit: () => void;
}

/**
 * The stretch of time a mode covers, which the operator moves every tile in
 * the mode through with the Timeline. Times are UT in seconds. Returned by a
 * mode's `useTimeline`.
 *
 * @category Modes
 */
export interface ModeTimeline {
  /** The first moment the timeline covers. */
  start: number;
  /** The last moment the timeline covers. */
  end: number;
  /** The moment every tile in the mode shows now. */
  at: number;
  /** Moves every tile in the mode to `ut`. */
  seek: (ut: number) => void;
  /** Moments the operator can jump to, such as each plan step reached. */
  marks?: readonly { ut: number; label: string }[];
  /** The first moment counts as T+0 when set, so times read as mission time; otherwise they read from `start`. */
  launchUt?: number;
  /** Present for a recording, which plays back; absent for a timeline only moved by hand. */
  playback?: ModePlayback;
}

/**
 * One mode: its name, when it is on, its order, and where its timeline comes
 * from. Passed to {@link registerMode}.
 *
 * While the mode is on, the operator has the sections Uplinks bind to its
 * `mode-sections.<id>` slot, and the Timeline while it has a timeline. How and
 * where they show is the app's to decide. A mode with no sections and no
 * timeline leaves the dashboard as it is.
 *
 * @category Modes
 */
export interface ModeDefinition {
  /** The mode's id, declared in {@link ModeRegistry}. */
  id: ModeId;
  /** The mode's name, such as "Design". */
  name: string;
  /**
   * A hook that answers whether the mode is on now. When several are on, the
   * one with the lowest `order` is the dashboard's mode.
   */
  useActive: () => boolean;
  /**
   * A hook that answers the mode's timeline, or `undefined` while it has
   * none. A recorded flight and a predicted run each have one.
   */
  useTimeline?: () => ModeTimeline | undefined;
  /**
   * Why the mode has no timeline while `useTimeline` answers none, such as
   * "No predicted run". With it, the operator keeps the Timeline for as long
   * as the mode is on and reads this there; without it, the operator has the
   * Timeline only while there is a timeline.
   */
  noTimeline?: string;
  /** Lower wins when several modes are on. Core's design is 10, replay 20 and live 1000; an Uplink's default to 50. */
  order?: number;
  /**
   * The colour the app draws the mode in, as a tone the theme gives a colour
   * to: the line round the mode's pane, the Timeline and the controls that
   * start the mode. Absent draws the mode in `info`. Core's live and replay
   * are `go` and its design is `info`.
   */
  tone?: Tone;
}

/**
 * A section's state in a few words, such as "Fails at step 3", with an
 * optional figure such as "margin -120 m/s". Passed to
 * {@link ModeSectionProps.reportStatus}.
 *
 * @category Modes
 */
export interface SectionStatus {
  /** The state in words, such as "Fails at step 3". */
  label: string;
  /** How good or bad the state is. */
  tone: Tone;
  /** A figure that goes with the state, such as "margin -120 m/s". */
  detail?: string;
}

/**
 * The props every augment bound to a mode's sections slot is given. Useful
 * for typing a section's component.
 *
 * @category Modes
 */
export interface ModeSectionProps {
  /**
   * Sets the section's state, or clears it with `undefined`. The app keeps
   * the first of a mode's section states in view even while the sections are
   * not. Call it from an effect.
   */
  reportStatus: (status: SectionStatus | undefined) => void;
}

/**
 * One input a Flight Plan step kind takes, such as an orbit's periapsis.
 * Values are kept in SI (metres, seconds, degrees, a fraction for percent)
 * and shown in `unit`. Used in a {@link PlanStepKind}'s `inputs`.
 *
 * @category Flight plan
 */
export interface PlanStepInput {
  /** The input's name in the step's editor, such as "Periapsis". */
  label: string;
  /** The unit the operator reads and types the value in. Absent for a name, such as a body. */
  unit?: "km" | "°" | "%" | "s";
  /** The value a new step starts with. A string input takes a name, such as a body. */
  default: number | string;
}

/**
 * A kind of step the Flight Plan offers under Add step: its inputs and how
 * its Δv need follows from them. The entry of the Flight Plan's step kinds
 * contribution slot. Useful for planning a flight around what an Uplink's mod
 * flies, such as an ascent guidance program.
 *
 * @category Flight plan
 */
export interface PlanStepKind {
  /** The kind a plan records, such as `"reach-orbit"` or `"guidance.ascent"`. Unique across every Uplink. */
  id: string;
  /** The step's name on its card and in Add step. */
  name: string;
  /** The Add step heading the kind is listed under. Core's kinds have none. */
  group?: string;
  /** The step's inputs by key, in the order the step's editor lists them. */
  inputs: Readonly<Record<string, PlanStepInput>>;
  /** The step's Δv need in m/s from its inputs, or `undefined` when there is no rule for them. */
  needsDv?: (
    inputs: Readonly<Record<string, number | string>>,
  ) => number | undefined;
  /** Core step kinds this kind does the work of, such as `["reach-orbit"]`. Recorded with the plan, not yet acted on. */
  covers?: readonly string[];
}

declare module "./types" {
  interface SlotRegistry {
    /**
     * Content for the operator in live mode, which is on whenever no other
     * mode is. The augment's `label` names the section. Passes
     * {@link ModeSectionProps}.
     */
    "mode-sections.live": ModeSectionProps;
    /**
     * Content for the operator in design mode, while a craft is in the
     * vehicle editor. The augment's `label` names the section. Passes
     * {@link ModeSectionProps}.
     */
    "mode-sections.design": ModeSectionProps;
    /**
     * Content for the operator in replay mode, while a recorded flight plays
     * back. The augment's `label` names the section. Passes
     * {@link ModeSectionProps}.
     */
    "mode-sections.replay": ModeSectionProps;
  }
  interface ContributionRegistry {
    /** Step kinds for the Flight Plan's Add step list, each a {@link PlanStepKind}. Name no `deps`: a kind does not change with the flight. */
    "flight-plan.steps": { entry: PlanStepKind };
  }
}

interface ModeState {
  modes: Map<string, ModeDefinition>;
  listeners: Set<() => void>;
  version: number;
}

const MODES_KEY = "__GONOGO_MODES__" as const;

function state(): ModeState {
  const g = globalThis as typeof globalThis & {
    [MODES_KEY]?: ModeState;
  };
  g[MODES_KEY] ??= { modes: new Map(), listeners: new Set(), version: 0 };
  return g[MODES_KEY];
}

/**
 * Declares a mode, with its name, when it is on and its timeline. Useful for
 * an Uplink whose mod shows the dashboard something other than the live game,
 * such as a simulation. Call it once, when the module loads. Registering an
 * id again replaces the earlier mode. Core registers `live`, `design` and `replay`.
 *
 * @category Modes
 */
export function registerMode(def: ModeDefinition): void {
  const s = state();
  s.modes.set(def.id, def);
  s.version += 1;
  for (const l of s.listeners) l();
}

/**
 * Every registered mode, lowest `order` first. Useful for testing that an
 * Uplink's mode registered.
 *
 * @category Modes
 */
export function getModes(): ModeDefinition[] {
  return [...state().modes.values()].sort(
    (a, b) => (a.order ?? 50) - (b.order ?? 50),
  );
}

/**
 * Every registered mode, lowest `order` first, read again when one registers.
 * Used by the app to find the mode that is on.
 *
 * @category Modes
 */
export function useModes(): ModeDefinition[] {
  const s = state();
  const version = useSyncExternalStore(
    (cb) => {
      s.listeners.add(cb);
      return () => s.listeners.delete(cb);
    },
    () => s.version,
    () => s.version,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` moves when a mode registers, which is when the list must be read again
  return useMemo(() => getModes(), [version]);
}

/**
 * One sample a mode's source supplies: a Topic's whole payload and the moment
 * it is true at. Part of a {@link ModeSourceOutput}.
 *
 * @category Modes
 */
export interface ModeSample {
  /** The Topic id. Any Topic about the game; never one of the dashboard's own (`mode.`, `system.`, `host.`, `settings.`). */
  topic: string;
  /** The moment the payload is true at, in UT seconds. */
  validAt: number;
  /** The Topic's payload, with every field the contract gives it. */
  payload: unknown;
  /**
   * Whether the craft the payload describes is coasting on rails or under
   * physics at that moment, as the game states it for a live sample. A
   * reckoner carries a sample forward only when it is on rails. Leave it out
   * for a Topic that describes no craft.
   */
  quality?: Quality;
}

/**
 * Everything a mode's source supplies for the stretch of time it covers: the
 * samples, and the timeline they lie on. Passed to
 * {@link ModeSourceContext.publish}.
 *
 * @category Modes
 */
export interface ModeSourceOutput {
  /** The first moment covered, in UT seconds. */
  startUt: number;
  /** The last moment covered. At or before `startUt` when there is nothing to show, with `noTimeline` saying why. */
  endUt: number;
  /** The samples, in any order. Each Topic is read as its newest sample at or before the moment on screen. */
  samples: readonly ModeSample[];
  /**
   * Frames recorded off the stream, each the exact text the mod sent, in any
   * order. Useful for a recording, which is played back as it was received,
   * events included. They are shown beside `samples`. A frame of one of the
   * dashboard's own Topics is left out.
   */
  frames?: readonly string[];
  /** The speeds the Timeline can play at, as multiples of real time. Absent offers the mod's own. */
  rates?: readonly number[];
  /** Moments the operator can jump to, such as each stage of a recorded flight. */
  marks?: readonly { ut: number; label: string }[];
  /** The moment that counts as T+0, so times read as mission time. */
  launchUt?: number;
  /** Why there is nothing to show, such as "No recording chosen". */
  noTimeline?: string;
}

/**
 * What a mode's source is given while its mode is on. Passed to
 * {@link ModeSource.start}.
 *
 * @category Modes
 */
export interface ModeSourceContext {
  /** The mode's inputs when the source started, by key. The source is started again when one changes. */
  inputs: Readonly<Record<string, string>>;
  /**
   * Calls `onValue` with the newest live payload of `topic` now and each time
   * it changes, and with the moment that payload is true at, in UT seconds,
   * where it is known. Returns its own release. The value is the live game's
   * even while the mode answers for the craft.
   *
   * `current` is false when the value is not the craft's present state: the
   * last one known from before contact with the craft was lost, or one its
   * recorder sent later. Nothing is called at all while the Topic has never
   * arrived. A source must not read either case as "there is nothing": it
   * leaves what it last published standing until a current value says so.
   */
  watch: (
    topic: string,
    onValue: (
      payload: unknown,
      validAt: number | undefined,
      current: boolean,
    ) => void,
  ) => () => void;
  /** Replaces everything the mode shows with `output`. Refused, with the reason returned, when a sample lacks a field its Topic's contract gives it. */
  publish: (output: ModeSourceOutput) => string | undefined;
}

/**
 * The code that answers for the craft while its mode is on. It runs on the hosting screen only,
 * while its mode is on, and what it publishes reaches every station from
 * there. Passed to {@link registerModeSource}.
 *
 * @category Modes
 */
export interface ModeSource {
  /** Starts the source. Returns its own stop, which releases everything it watched. */
  start: (context: ModeSourceContext) => () => void;
}

const SOURCES_KEY = "__GONOGO_MODE_SOURCES__" as const;

function sources(): Map<string, ModeSource> {
  const g = globalThis as typeof globalThis & {
    [SOURCES_KEY]?: Map<string, ModeSource>;
  };
  g[SOURCES_KEY] ??= new Map();
  return g[SOURCES_KEY];
}

/**
 * Registers the source that answers for the craft while a mode is on, such
 * as a recorded flight. Useful for an Uplink whose mode shows the dashboard
 * values other than the live game's. Call it once, when the module loads.
 * Registering a mode again replaces the earlier source. Used by replay.
 *
 * @category Modes
 */
export function registerModeSource(mode: ModeId, source: ModeSource): void {
  sources().set(mode, source);
}

/**
 * The source registered for a mode, or `undefined` when none is. Useful for
 * testing that an Uplink's source registered.
 *
 * @category Modes
 */
export function getModeSource(mode: string): ModeSource | undefined {
  return sources().get(mode);
}
