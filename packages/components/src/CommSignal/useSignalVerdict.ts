import { useTelemetry } from "@ksp-gonogo/core";
import {
  CONTROL_STATE_NAMES,
  type CommsMeasuredPath,
  type ControlStateName,
  collapseControlStateLevel,
  enumNameOf,
  type TinyEssential,
  type TinyEssentialMark,
  type TinyEssentialTone,
} from "@ksp-gonogo/sitrep-sdk";
import {
  type ControlDescription,
  describeControl,
  signalBarCount,
} from "./signalVerdict";
import type { Tone } from "./tones";

export interface SignalVerdict {
  connected: boolean | undefined;
  /** The link state stopped arriving, so every verdict below is withheld. */
  noSignal: boolean;
  /** Nothing about the link has arrived yet. */
  nothingHasArrived: boolean;
  /**
   * Nothing has arrived and something is on its way: the first light-time of a
   * session, when the craft's first word has not crossed the distance yet.
   * That is not a verdict on the link, so it never reads as no signal. A
   * topic that arrived saying it has nothing is an answer, and is not awaited.
   */
  awaitingFirstSignal: boolean;
  /** Signal strength as a 0 to 1 fraction, where one is current and positive. */
  pct: number | null;
  bars: number | null;
  control: ControlDescription;
  /** The observed strength reading, or null wherever `pct` is. */
  strengthReading: TinyEssential["value"];
  /**
   * How the strength is marked, or null where it is the measured worth of the
   * path this command centre believes in. Worked out for that path where the
   * craft's radio has not reported on it; or measured, but on another path.
   */
  strengthMark: TinyEssentialMark | null;
}

/** What the modelled mark on the strength means, on hover and in the spoken name. */
export const MODELLED_STRENGTH =
  "Worked out for the path this command centre believes in, not measured";

/** The craft's own figure, drawn until this command centre is sent a strength for its own path. */
export const CRAFT_ROUTE_STRENGTH =
  "Measured by the craft on the route it was using: this command centre has not been sent a strength for the path it believes in";

/** The stops' names in order, which is all the route's wording reads of a measured path. */
interface MeasuredPath {
  nodes: ReadonlyArray<Pick<CommsMeasuredPath["nodes"][number], "displayName">>;
}

/** The route in words, from the first stop after the vessel to the last: "via Relay A to KSC", or "direct to KSC" for one hop. Undefined where the path names no stop. */
export function measuredRoute(
  path: MeasuredPath | null | undefined,
): string | undefined {
  const stops = (path?.nodes ?? [])
    .slice(1)
    .map((node) => node.displayName.trim())
    .filter((name) => name.length > 0);
  const end = stops.pop();
  if (end === undefined) return undefined;
  return stops.length === 0
    ? `direct to ${end}`
    : `via ${stops.join(", ")} to ${end}`;
}

/**
 * What the mark means on a strength the craft's radio measured on a path this
 * command centre does not believe in, naming that path where the stream says
 * which it was.
 */
export function otherPathStrength(path?: MeasuredPath | null): string {
  const route = measuredRoute(path);
  return route === undefined
    ? "Measured on another path: the craft's radio reported this on a route this command centre does not believe in"
    : `Measured ${route}, a route this command centre does not believe in`;
}

function strengthMarkOf(
  told:
    | {
        modelled: boolean;
        otherPath: boolean;
        measuredPath?: MeasuredPath | null;
      }
    | undefined,
  fromCraft: boolean,
): TinyEssentialMark | null {
  if (fromCraft) return { elsewhere: true, caption: CRAFT_ROUTE_STRENGTH };
  if (told?.modelled === true)
    return { kind: "modelled", caption: MODELLED_STRENGTH };
  if (told?.otherPath === true)
    return { elsewhere: true, caption: otherPathStrength(told.measuredPath) };
  return null;
}

/** The link verdict the body and the tiny essentials both draw. */
export function useSignalVerdict(): SignalVerdict {
  // A held "connected: true" from before a gap is the most misleading thing this widget could draw: silence is evidence about a link.
  const linkReading = useTelemetry("comms.link");
  const commsReading = useTelemetry("vessel.comms");
  const connected =
    linkReading.state === "observed" ? linkReading.value.connected : undefined;
  // The strength sent to this command centre for the path it believes in. The craft's own figure is of whatever path the game had it on, and stands in only until the centre is sent one.
  const signalReading = useTelemetry("comms.signal");
  const told =
    signalReading.state === "observed" ? signalReading.value : undefined;
  const strength =
    told?.strength ??
    (commsReading.state === "observed"
      ? commsReading.value.signalStrength
      : undefined);
  const noSignal =
    linkReading.state === "held" || commsReading.state === "held";
  // Kept through a held reading because a pill that blanked between frames would read as a control loss; `noSignal` withholds it on screen.
  const commsHeld =
    commsReading.state === "observed" || commsReading.state === "held"
      ? commsReading.value
      : undefined;
  const controlState =
    commsHeld === undefined
      ? undefined
      : collapseControlStateLevel(commsHeld.controlState);
  const controlStateName = enumNameOf<ControlStateName>(
    CONTROL_STATE_NAMES,
    commsHeld?.controlState,
  );

  const raw = strength?.magnitude;
  const strengthValid =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0;
  const pct = strengthValid ? Math.max(0, Math.min(1, raw)) : null;
  const nothingHasArrived =
    connected === undefined &&
    strength === undefined &&
    controlState === undefined;
  return {
    connected,
    noSignal,
    nothingHasArrived,
    awaitingFirstSignal:
      nothingHasArrived &&
      !noSignal &&
      linkReading.state !== "absent" &&
      commsReading.state !== "absent" &&
      (linkReading.state === "pending" || commsReading.state === "pending"),
    pct,
    bars: signalBarCount({ noSignal, connected, pct, controlState }),
    control: describeControl(controlStateName, controlState),
    strengthReading:
      pct === null
        ? null
        : told === undefined
          ? commsReading.signalStrength
          : signalReading.strength,
    // The craft's own figure is of whatever path the game had it on, which is another path as far as this centre can say.
    strengthMark:
      pct === null
        ? null
        : strengthMarkOf(
            told,
            told?.strength === undefined || told.strength === null,
          ),
  };
}

const ESSENTIAL_TONE: Record<Tone, TinyEssentialTone> = {
  ok: "go",
  warn: "warn",
  lost: "nogo",
  neutral: "neutral",
};

/** The tiny tile's word for the first light-time, before the link has said anything. */
export const AWAITING_WORD = "AWAIT";

/** The signal figure with its bars, which is all a tiny tile has room for; a lost link says LOS beside the bars, as the body's headline does. */
export function useCommSignalEssentials(): readonly TinyEssential[] {
  const {
    connected,
    noSignal,
    awaitingFirstSignal,
    bars,
    control,
    strengthReading,
    strengthMark,
  } = useSignalVerdict();
  const level = { lit: bars, of: 4 };
  if (awaitingFirstSignal) {
    return [{ label: "Signal", word: AWAITING_WORD, level, tone: "neutral" }];
  }
  if (noSignal) {
    return [{ label: "Signal", value: null, level, tone: "neutral" }];
  }
  if (connected === false) {
    return [{ label: "Signal", word: "LOS", level, tone: "nogo" }];
  }
  return [
    {
      label: "Signal",
      value: strengthReading,
      mark: strengthMark ?? undefined,
      level,
      tone: ESSENTIAL_TONE[control.tone],
    },
  ];
}
