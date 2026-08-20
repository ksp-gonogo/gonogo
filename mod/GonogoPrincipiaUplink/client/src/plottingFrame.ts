import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";

/**
 * The plotting frame's kinds, by the producer's own enum ordinal, and the label
 * built from one.
 *
 * <para><b>Why this is named on OUR side.</b> The producer offers four members
 * that would each hand over a formatted frame name, and every one of them
 * reaches its fatal-log helper through a default branch, which aborts the KSP
 * process. So the ordinal travels on the wire and the label is built here. This
 * table is the thing that keeps that true: without it, the next person needing a
 * frame name reaches for the producer's namer, because it is right there and
 * looks like a getter. See `ReflectedMembers.InvocableMembers` for the rule.</para>
 *
 * <para>It survives the removal of the widget that used it. `PropagationProvenance`
 * was rejected as a surface (an operator should never meet the word "propagator")
 * and the frame belongs on the numbers it qualifies instead, but the CONTENT is
 * still wanted and this is the part of it that cost a decompile to establish.</para>
 */
const FRAME_NAMES: Readonly<Record<number, string>> = {
  0: "Body-centred non-rotating",
  1: "Barycentric rotating",
  2: "Body surface",
  3: "Rotating-pulsating",
  4: "Body-centred parent direction",
};

/**
 * A frame's human label, or the null display when the ordinal is unknown.
 *
 * An unrecognised ordinal renders AS the ordinal rather than as a guess: a frame
 * kind added in a later build should read as "Frame 7", obviously incomplete,
 * instead of being rounded to whichever neighbour is closest. A wrong frame name
 * is a wrong claim about what every coordinate on the dashboard means.
 */
export function plottingFrameLabel(
  ordinal: number | null | undefined,
  centreBody?: string | null,
): string {
  if (ordinal === null || ordinal === undefined) return NULL_DISPLAY;
  const kind = FRAME_NAMES[ordinal] ?? `Frame ${ordinal}`;
  return centreBody ? `${kind}, ${centreBody}` : kind;
}
