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
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import {
  type ControlDescription,
  describeControl,
  describeQuantity,
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
   * Nothing has arrived and something is on its way: the first signal delay of a
   * session, when the craft's first word has not crossed the distance yet.
   * That is not a verdict on the link, so it never reads as no signal. A
   * topic that arrived saying it has nothing is an answer, and is not awaited.
   */
  awaitingFirstSignal: boolean;
  /** Signal strength as a 0 to 1 fraction, where one is current and positive. */
  pct: number | null;
  bars: number | null;
  control: ControlDescription;
  /** What the strength measures where the headline figure does not say, as the elected comms backend declares it, or null. */
  quantity: string | null;
  /** The observed strength reading, or null wherever `pct` is. */
  strengthReading: TinyEssential["value"];
  /** How the strength is marked, or null where it is the measured worth of the active route. Only a figure worked out for that route is marked. */
  strengthMark: TinyEssentialMark | null;
  /**
   * The headline figure is still to come: this command centre has not been sent
   * a strength for the active route, and the craft's own figure is not drawn in
   * its place.
   */
  strengthAwaited: boolean;
  /** A sentence for the headline's tooltip: the craft's own figure while the active route's is awaited, or what a figure measured on another route is. Null where there is nothing to add. */
  strengthTip: string | null;
}

/** What the modelled mark on the strength means, on hover and in the spoken name. */
export const MODELLED_STRENGTH =
  "Worked out for the active route, not measured";

/** What the craft's own figure is, offered on the headline's tooltip while this command centre has not been sent a strength for the active route. */
export function craftFigureCaption(
  figure: Value<"ratio">,
  quantity: string | null,
): string {
  const named = quantity === null ? "" : ` (${quantity.toLowerCase()})`;
  return `The craft's own radio reports ${writeQuantity(figure, { as: "%", decimals: 0 })}${named}, on the route it was using. The strength of the active route has not arrived yet`;
}

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
 * What the mark means on a strength the craft's radio measured on a route other
 * than the active route, naming that path where the stream says
 * which it was.
 */
export function otherPathStrength(path?: MeasuredPath | null): string {
  const route = measuredRoute(path);
  return route === undefined
    ? "Measured by the craft's radio on a route other than the active route"
    : `Measured ${route}, a route other than the active route`;
}

function strengthMarkOf(
  told: { modelled: boolean } | undefined,
): TinyEssentialMark | null {
  if (told?.modelled === true)
    return { kind: "modelled", caption: MODELLED_STRENGTH };
  return null;
}

/** The link verdict the body and the tiny essentials both draw. */
export function useSignalVerdict(): SignalVerdict {
  // A held "connected: true" from before a gap is the most misleading thing this widget could draw: silence is evidence about a link.
  const linkReading = useTelemetry("comms.link");
  const commsReading = useTelemetry("vessel.comms");
  const connected =
    linkReading.state === "observed" ? linkReading.value.connected : undefined;
  // The strength sent to this command centre for the active route. The craft's own figure is of whatever path the game had it on, so it is never drawn in its place.
  const signalReading = useTelemetry("comms.signal");
  const told =
    signalReading.state === "observed" ? signalReading.value : undefined;
  const strength = told?.strength;
  const craftStrength =
    commsReading.state === "observed"
      ? commsReading.value.signalStrength
      : undefined;
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
  const craftFigure =
    craftStrength?.greaterThan(0) === true ? craftStrength : null;
  const nothingHasArrived =
    connected === undefined &&
    strength === undefined &&
    craftStrength === undefined &&
    controlState === undefined;
  const strengthAwaited = told === undefined;
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
    bars: signalBarCount({
      noSignal,
      connected,
      pct,
      controlState,
      controlBars: !strengthAwaited,
    }),
    control: describeControl(controlStateName, controlState),
    // The quantity is the sent strength's; with none sent there is no figure to describe.
    quantity: told === undefined ? null : describeQuantity(told.quantity),
    strengthReading:
      pct === null || told === undefined ? null : signalReading.strength,
    strengthMark: pct === null ? null : strengthMarkOf(told),
    strengthAwaited,
    strengthTip:
      told === undefined
        ? craftFigure === null
          ? null
          : craftFigureCaption(
              craftFigure,
              describeQuantity(commsHeld?.signalQuantity),
            )
        : pct !== null && told.otherPath === true
          ? otherPathStrength(told.measuredPath)
          : null,
  };
}

const ESSENTIAL_TONE: Record<Tone, TinyEssentialTone> = {
  ok: "go",
  warn: "warn",
  lost: "nogo",
  neutral: "neutral",
};

/** The tiny tile's word for the first signal delay, before the link has said anything. */
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
