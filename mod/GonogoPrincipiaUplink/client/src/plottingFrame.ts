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
 * <para><b>The keys are the producer's declared enum VALUES, not positions.</b>
 * Its frame enum is explicitly numbered from 6000, and the producer hands the
 * value straight through, so the wire has only ever carried 6000 to 6004. The
 * first version of this table was keyed 0 to 4, in an order that matched neither
 * the declaration nor the numbering, which made every real frame fall through to
 * the unknown-ordinal branch and render as "Frame 6000". The test could not see
 * it: it asserted the same invented keys the table was built from, so both were
 * wrong together and agreed. `FRAME_TYPE` below is now the single statement of
 * what the numbers are, and the test asserts against the producer's enum.</para>
 */
export const FRAME_TYPE = {
  /** `BODY_CENTRED_NON_ROTATING`. Centre-bearing, so apsides exist in it. */
  bodyCentredInertial: 6000,
  /** `BARYCENTRIC_ROTATING`. The producer's own descriptions read "DEPRECATED". */
  barycentricRotating: 6001,
  /** `BODY_CENTRED_PARENT_DIRECTION`. Illegal for a root body. */
  parentDirection: 6002,
  /** `BODY_SURFACE`. Force-selected on atmospheric entry in surface speed mode. */
  bodySurface: 6003,
  /** `ROTATING_PULSATING`. Lagrange frame; lengths in it are not lengths. */
  rotatingPulsating: 6004,
} as const;

/**
 * Each kind's label, in the producer's own English wording, with the placeholders
 * it uses. `<centre>` is the frame's centre body, `<primary>` the body the frame
 * rotates about and `<secondary>` the one it is anchored to, which are the same
 * two the producer passes to its own format strings.
 */
const FRAME_NAMES: Readonly<Record<number, string>> = {
  [FRAME_TYPE.bodyCentredInertial]: "<centre>-Centred Inertial",
  [FRAME_TYPE.barycentricRotating]: "Barycentric rotating",
  [FRAME_TYPE.parentDirection]: "<secondary>-<primary>-Orbit",
  [FRAME_TYPE.bodySurface]: "<centre>-Centred <centre>-Fixed",
  [FRAME_TYPE.rotatingPulsating]: "<primary>-<secondary> Lagrange",
};

/** The bodies a frame's name is declined with, all optional. */
export interface FrameBodies {
  centre?: string | null;
  primary?: string | null;
  secondary?: string | null;
}

/**
 * A frame's human label, or the null display when the ordinal is unknown.
 *
 * An unrecognised ordinal renders AS the ordinal rather than as a guess: a frame
 * kind added in a later build should read as "Frame 6007", obviously incomplete,
 * instead of being rounded to whichever neighbour is closest. A wrong frame name
 * is a wrong claim about what every coordinate on the dashboard means.
 *
 * A body the payload did not carry leaves its placeholder standing rather than
 * collapsing the sentence, for the same reason: "<centre>-Centred Inertial" says
 * a body is missing, where "-Centred Inertial" reads like a formatting slip.
 */
export function plottingFrameLabel(
  ordinal: number | null | undefined,
  bodies?: FrameBodies | string | null,
): string {
  if (ordinal === null || ordinal === undefined) return NULL_DISPLAY;
  const named: FrameBodies =
    typeof bodies === "string" ? { centre: bodies } : (bodies ?? {});
  const template = FRAME_NAMES[ordinal];
  if (template === undefined) {
    const centre = named.centre;
    return centre ? `Frame ${ordinal}, ${centre}` : `Frame ${ordinal}`;
  }
  return template
    .replace(/<centre>/g, named.centre ?? "<centre>")
    .replace(/<primary>/g, named.primary ?? "<primary>")
    .replace(/<secondary>/g, named.secondary ?? "<secondary>");
}

/**
 * True when a distance quoted in this frame is not a distance.
 *
 * The rotating-pulsating frame holds its two primaries' separation fixed, so its
 * length unit varies with time. A readout stamped with this frame must suppress
 * absolute lengths or label them as pulsating-frame units, and that is a physics
 * rule rather than a wording choice, so it lives here once instead of in each
 * widget that quotes a length.
 */
export function frameLengthsPulsate(
  ordinal: number | null | undefined,
): boolean {
  return ordinal === FRAME_TYPE.rotatingPulsating;
}

/**
 * True when apsides exist in this frame at all.
 *
 * The producer's own centre lookup returns nothing for the barycentric and
 * rotating-pulsating frames, and the target frame returns before apsides are
 * computed. In those an apsis is not merely unavailable, it is undefined, which
 * is a different thing to say to an operator than "not measured".
 */
export function frameHasApsides(
  ordinal: number | null | undefined,
  targetFrameSelected?: boolean | null,
): boolean {
  if (targetFrameSelected) return false;
  return (
    ordinal === FRAME_TYPE.bodyCentredInertial ||
    ordinal === FRAME_TYPE.parentDirection ||
    ordinal === FRAME_TYPE.bodySurface
  );
}
