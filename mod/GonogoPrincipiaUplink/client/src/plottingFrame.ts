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
 * Each kind's label, and it is the producer's OWN string rather than a paraphrase
 * of one. `<centre>` is the frame's centre body, `<primary>` the body the frame
 * rotates about and `<secondary>` the one it is anchored to, which are the same
 * two the producer passes to its own format strings.
 *
 * <para><b>Taken from the installed build's `localization/en-us.cfg`</b>, key by
 * key, so an operator reading a frame name here and the same frame in game is not
 * translating between two vocabularies. That includes the punctuation: the
 * producer separates two BODIES with an en dash and joins a body to a word with a
 * hyphen, and it does the two differently on purpose. Ours were hyphens
 * throughout, which is a different string from the one on the player's screen.</para>
 *
 * <para>`barycentricRotating` is the one entry with no counterpart. The producer
 * has no name string for it and describes it as "DEPRECATED": its own selector
 * cannot reach it, so the wording here is ours and is only reachable by a save
 * that already held the frame.</para>
 */
const FRAME_NAMES: Readonly<Record<number, string>> = {
  [FRAME_TYPE.bodyCentredInertial]: "<centre>-Centred Inertial",
  [FRAME_TYPE.barycentricRotating]: "Barycentric rotating",
  [FRAME_TYPE.parentDirection]: "<secondary>\u2013<primary>\u2013Orbit",
  [FRAME_TYPE.bodySurface]: "<centre>-Centred <centre>-Fixed",
  [FRAME_TYPE.rotatingPulsating]: "<primary>\u2013<secondary> Lagrange",
};

/**
 * The target frame's name, which sits OUTSIDE the kind table for the same reason
 * the flag does: the producer keeps the frame kind and the target selection as
 * two independent pieces of state, and while a target frame is selected its name
 * replaces the kind's entirely.
 *
 * Declined with the body the TARGET vessel orbits, not with the celestial the
 * selector happens to be sitting on. Those are different bodies, and using the
 * wrong one names a frame the player is not in.
 */
const TARGET_FRAME_NAME = "Target\u2013<targetPrimary>\u2013Orbit";

/**
 * Each kind's own name, undeclined. A settings row wants the KIND ("Body-centred
 * inertial") beside the declined instance ("Kerbin-Centred Inertial"), because
 * the two answer different questions: which frame am I in, and what sort of
 * frame is that. Keyed the same way {@link FRAME_NAMES} is, off the producer's
 * declared enum values.
 */
const FRAME_KINDS: Readonly<Record<number, string>> = {
  [FRAME_TYPE.bodyCentredInertial]: "Body-centred inertial",
  [FRAME_TYPE.barycentricRotating]: "Barycentric rotating",
  [FRAME_TYPE.parentDirection]: "Body-centred parent direction",
  [FRAME_TYPE.bodySurface]: "Body surface",
  [FRAME_TYPE.rotatingPulsating]: "Rotating pulsating",
};

/**
 * A frame kind's name, or the null display when there is no ordinal.
 *
 * An unrecognised ordinal reads as "Frame 6007" for the same reason
 * {@link plottingFrameLabel}'s does: a kind added in a later build must look
 * incomplete rather than be rounded to a neighbour.
 *
 * The target frame answers this too, and has to: with the target selected the
 * ordinal describes a frame the player is not in, so a kind read off it would
 * contradict the frame named beside it. The producer has no kind word for the
 * target frame, since it is not in the kind enum at all, so this one is ours.
 */
export function plottingFrameKindLabel(
  ordinal: number | null | undefined,
  targetFrameSelected?: boolean | null,
): string {
  if (targetFrameSelected) return "Target frame";
  if (ordinal === null || ordinal === undefined) return NULL_DISPLAY;
  return FRAME_KINDS[ordinal] ?? `Frame ${ordinal}`;
}

/** The bodies a frame's name is declined with, all optional. */
export interface FrameBodies {
  centre?: string | null;
  primary?: string | null;
  secondary?: string | null;
  /**
   * The body the target vessel orbits, which is what the target frame's name is
   * declined with.
   */
  targetPrimary?: string | null;
  /**
   * Whether the target frame is selected, which OVERRIDES the kind: the producer
   * shows its own target-frame name and ignores the frame type entirely, so a
   * caller passing the type alone gets the name of a frame nobody is in.
   */
  targetSelected?: boolean | null;
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
  const named: FrameBodies =
    typeof bodies === "string" ? { centre: bodies } : (bodies ?? {});
  // The target frame is named before the ordinal is even consulted, because a
  // target frame HAS no kind: the producer returns its own name for one and
  // never reaches the kind table. A missing ordinal is no obstacle to naming it.
  if (named.targetSelected === true) {
    return TARGET_FRAME_NAME.replace(
      /<targetPrimary>/g,
      named.targetPrimary ?? "<targetPrimary>",
    );
  }
  if (ordinal === null || ordinal === undefined) return NULL_DISPLAY;
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
