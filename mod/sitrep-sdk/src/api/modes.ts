import { useMemo, useSyncExternalStore } from "react";
import type { Tone } from "./tone";

/*
 * The mode registry lives here, not in core, because an Uplink may declare a
 * mode of its own, and its state sits in one global slot so an Uplink that
 * bundles this package still registers into the app's copy. Same reasoning as
 * `./map-poi.ts`.
 */

/**
 * Every mode the dashboard can be in, by id. A mode is what the dashboard
 * shows: `default` is the game as it is now, and the mode the dashboard is in
 * when no other is on; `design` is the craft in the vehicle editor and its
 * predicted flight; `replay` is a recorded flight played back. Useful for
 * naming the modes a widget shows in and a section belongs to.
 *
 * An Uplink declares its own mode by declaration merging, then registers it
 * with {@link registerMode}:
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
  default: true;
  /** The craft in the vehicle editor and its predicted flight. */
  design: true;
  /** A recorded flight, played back. */
  replay: true;
}

/**
 * The id of a mode in {@link ModeRegistry}, such as `"design"`. Taken by a
 * widget's `modes` and by {@link registerMode}.
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
  /** Lower wins when several modes are on. Core's design is 10, replay 20 and default 1000; an Uplink's default to 50. */
  order?: number;
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
     * Content for the operator in the default mode, which is on in every
     * scene. The augment's `label` names the section. Passes
     * {@link ModeSectionProps}.
     */
    "mode-sections.default": ModeSectionProps;
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
 * id again replaces the earlier mode. Core registers `default`, `design` and `replay`.
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
