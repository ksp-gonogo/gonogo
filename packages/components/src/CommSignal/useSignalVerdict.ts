import { useTelemetry } from "@ksp-gonogo/core";
import {
  CONTROL_STATE_NAMES,
  type ControlStateName,
  collapseControlStateLevel,
  enumNameOf,
  type TinyEssential,
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
  /** Signal strength as a 0 to 1 fraction, where one is current and positive. */
  pct: number | null;
  bars: number | null;
  control: ControlDescription;
  /** The observed strength reading, or null wherever `pct` is. */
  strengthReading: TinyEssential["value"];
}

/** The link verdict the body and the tiny essentials both draw. */
export function useSignalVerdict(): SignalVerdict {
  // A held "connected: true" from before a gap is the most misleading thing this widget could draw: silence is evidence about a link.
  const linkReading = useTelemetry("comms.link");
  const commsReading = useTelemetry("vessel.comms");
  const connected =
    linkReading.state === "observed" ? linkReading.value.connected : undefined;
  const strength =
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
  return {
    connected,
    noSignal,
    nothingHasArrived:
      connected === undefined &&
      strength === undefined &&
      controlState === undefined,
    pct,
    bars: signalBarCount({ noSignal, connected, pct, controlState }),
    control: describeControl(controlStateName, controlState),
    strengthReading: pct === null ? null : commsReading.signalStrength,
  };
}

const ESSENTIAL_TONE: Record<Tone, TinyEssentialTone> = {
  ok: "go",
  warn: "warn",
  lost: "nogo",
  neutral: "neutral",
};

/** The signal figure with its bars, which is all a tiny tile has room for; a lost link says LOS beside the bars, as the body's headline does. */
export function useCommSignalEssentials(): readonly TinyEssential[] {
  const { connected, noSignal, bars, control, strengthReading } =
    useSignalVerdict();
  const level = { lit: bars, of: 4 };
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
      level,
      tone: ESSENTIAL_TONE[control.tone],
    },
  ];
}
