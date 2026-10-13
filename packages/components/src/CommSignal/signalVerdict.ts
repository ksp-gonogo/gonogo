import { SignalQuantity } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import type { Tone } from "./tones";

export interface ControlDescription {
  label: string;
  tone: Tone;
}

/**
 * What to call the control state, and how to paint it. The tone comes off the
 * collapsed ordinal, never the name: `ProbeNone` and `KerbalNone` are not the
 * string "None" and would otherwise paint green. An undefined level is not a
 * link failure, so it paints neutral rather than lost.
 */
export function describeControl(
  name: string | undefined,
  state: number | undefined,
): ControlDescription {
  return { label: controlLabel(name, state), tone: controlTone(state) };
}

function controlLabel(name: string | undefined, state: number | undefined) {
  if (name && name.length > 0) return name;
  if (state === 2) return "Full";
  if (state === 1) return "Partial";
  if (state === 0) return "None";
  return NULL_DISPLAY;
}

function controlTone(state: number | undefined): Tone {
  if (state === 0) return "lost";
  if (state === 1) return "warn";
  if (state === 2) return "ok";
  return "neutral";
}

/**
 * How many of the four bars are lit, or `null` when nothing arrived to judge
 * the link by: a count of zero is a verdict. Where the strength was said to be
 * absent (no link budget modelled), bars derive from the control state (Full 4,
 * Partial 2, None 0); where it has not arrived, there are none.
 */
export function signalBarCount({
  noSignal,
  connected,
  pct,
  controlState,
  controlBars,
}: {
  noSignal: boolean;
  connected: boolean | undefined;
  pct: number | null;
  controlState: number | undefined;
  /** Whether the control state may stand in for a strength that was said to be absent. False while the strength is still to come: the control state is then the craft's own word and not the active route's. */
  controlBars: boolean;
}): number | null {
  // Withheld: `controlState` is read off the held `vessel.comms`, so the bars would otherwise paint a confident "Full" above a caption saying the verdict is held.
  if (noSignal) return 0;
  if (connected === false) return 0;
  if (pct !== null) return Math.max(1, Math.ceil(pct * 4));
  if (!controlBars) return null;
  if (controlState === 2) return 4;
  if (controlState === 1) return 2;
  if (controlState === 0) return 0;
  return null;
}

/** The route's size in the caption when the route itself is not drawn. */
export function hopHint({
  connected,
  hopCount,
  relayCount,
  showFullPath,
}: {
  connected: boolean | undefined;
  hopCount: number;
  relayCount: number;
  showFullPath: boolean;
}): string {
  if (connected === false || hopCount === 0 || showFullPath) return "";
  if (relayCount === 0) return " (direct)";
  return ` (${relayCount} relay${relayCount === 1 ? "" : "s"})`;
}

/** "Signal to <centre>" names the far end the receiving centre resolved, and reads just "Signal" where none is named. It asserts a signal, so it nulls whenever the link verdict is absent or held. */
export function signalCaption({
  noSignal,
  connected,
  centreLabel,
  hint,
}: {
  noSignal: boolean;
  connected: boolean | undefined;
  centreLabel: string | undefined;
  hint: string;
}): string {
  if (noSignal || connected === undefined) return NULL_DISPLAY;
  if (connected === false) return "No signal";
  return `${centreLabel === undefined ? "Signal" : `Signal to ${centreLabel}`}${hint}`;
}

/** Announces only the connection-state transition; the streaming readout must not be a live region. */
export function connectionAnnouncement(connected: boolean | undefined): string {
  if (connected === false) return "Signal lost";
  if (connected === true) return "Signal connected";
  return "";
}

/**
 * What the strength measures, in words, for the detail grid beside its label,
 * or null where the headline figure already says it: KSP's own signal
 * strength reads as a plain percentage and needs no second line, and nothing
 * says what an unknown quantity is.
 */
export function describeQuantity(
  quantity: SignalQuantity | undefined,
): string | null {
  switch (quantity) {
    case SignalQuantity.DataRateHeadroom:
      return "Data-rate ladder position";
    case SignalQuantity.NoModel:
      return "Not modelled";
    default:
      return null;
  }
}
