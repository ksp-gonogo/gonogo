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
 * the link by: a count of zero is a verdict. With no strength reading, bars
 * derive from the control state (Full 4, Partial 2, None 0).
 */
export function signalBarCount({
  noSignal,
  connected,
  pct,
  controlState,
}: {
  noSignal: boolean;
  connected: boolean | undefined;
  pct: number | null;
  controlState: number | undefined;
}): number | null {
  // Withheld: `controlState` is read off the held `vessel.comms`, so the bars would otherwise paint a confident "Full" above a caption saying the verdict is held.
  if (noSignal) return 0;
  if (connected === false) return 0;
  if (pct !== null) return Math.max(1, Math.ceil(pct * 4));
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

/** "Signal to <centre>" asserts a signal, so it nulls whenever the link verdict is absent or held. */
export function signalCaption({
  noSignal,
  connected,
  centreLabel,
  hint,
}: {
  noSignal: boolean;
  connected: boolean | undefined;
  centreLabel: string;
  hint: string;
}): string {
  if (noSignal || connected === undefined) return NULL_DISPLAY;
  if (connected === false) return "No signal";
  return `Signal to ${centreLabel}${hint}`;
}

/** Announces only the connection-state transition; the streaming readout must not be a live region. */
export function connectionAnnouncement(connected: boolean | undefined): string {
  if (connected === false) return "Signal lost";
  if (connected === true) return "Signal connected";
  return "";
}
