import type { CSSProperties, ReactNode } from "react";
import { RECKONING_MARK } from "../reckoningMarkSpec";
import { VisuallyHidden } from "../VisuallyHidden";

/** Two values closer than this share a position, as a tenth of a step. */
function same(a: number, b: number, step: number): boolean {
  return Math.abs(a - b) < step / 10;
}

/**
 * Which of the expected and last-seen values a command control draws. The
 * last-seen value is drawn whenever it is given, since it is given only while
 * the craft's readings are held; `onCommanded` says it sits on the value
 * commanded. The expected value is drawn only where it differs from both.
 * Useful for a command control of your own that marks the same values as the
 * kit's. Used by {@link Slider} and {@link Stepper}.
 *
 * @category Form
 */
export function commandValueMarks({
  commanded,
  expected,
  lastSeen,
  step,
}: {
  commanded: number | null;
  expected?: number | null;
  lastSeen?: number | null;
  step: number;
}): {
  expected: number | null;
  lastSeen: number | null;
  /** The last-seen value equals the value commanded, so the command's own figure carries the held mark. */
  onCommanded: boolean;
} {
  const near = (a: number | null | undefined, b: number | null | undefined) =>
    a != null && b != null && same(a, b, step);
  const shownLastSeen = lastSeen ?? null;
  const shownExpected =
    expected != null &&
    !near(expected, commanded) &&
    !near(expected, shownLastSeen)
      ? expected
      : null;
  return {
    expected: shownExpected,
    lastSeen: shownLastSeen,
    onCommanded: near(shownLastSeen, commanded),
  };
}

/**
 * The held square or modelled triangle a command control draws, in the kit's
 * mark hues, ringed in the app surface so it stays distinct on the slider's
 * fill and on its bare track alike.
 */
export function MarkShape({ kind }: { kind: "held" | "modelled" }) {
  return (
    <svg
      aria-hidden="true"
      width={MARK_PX}
      height={MARK_PX}
      viewBox="0 0 16 16"
      style={{ display: "block", overflow: "visible" }}
    >
      {kind === "held" ? (
        <rect x="2" y="2" width="12" height="12" style={MARK_PAINT.held} />
      ) : (
        <polygon points="8,1.5 14.8,14 1.2,14" style={MARK_PAINT.modelled} />
      )}
    </svg>
  );
}

/**
 * A mark drawn on a slider's track at a value, with its caption spoken. It
 * takes no pointer, so a press on the track at a mark still moves the thumb
 * there.
 */
export function TrackMark({
  kind,
  caption,
  left,
}: {
  kind: "held" | "modelled";
  caption: string;
  left: string;
}) {
  return (
    <span
      data-role={kind === "modelled" ? "expected" : "last-seen"}
      data-reckoning-mark={kind}
      style={{ ...TRACK_MARK, left }}
    >
      <MarkShape kind={kind} />
      <VisuallyHidden>{caption}</VisuallyHidden>
    </span>
  );
}

/** A stepper's secondary figure with its mark beside it at the size the slider draws it. */
export function MarkedFigure({
  kind,
  caption,
  main = false,
  children,
}: {
  kind: "held" | "modelled";
  caption: string;
  /** The command's own figure, drawn at its full size, rather than a secondary one. */
  main?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      data-role={kind === "modelled" ? "expected" : "last-seen"}
      data-reckoning-mark={kind}
      data-held={kind === "held" ? "" : undefined}
      style={main ? MAIN_MARKED : SECONDARY}
    >
      <MarkShape kind={kind} />
      {children}
      <VisuallyHidden data-unit-currency="">, {caption}</VisuallyHidden>
    </span>
  );
}

export const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-related)",
};

export const TRACK: CSSProperties = {
  flex: 1,
  position: "relative",
  display: "flex",
  alignItems: "center",
};

export const FULL_WIDTH: CSSProperties = { width: "100%" };

/** A mark centred on the track at a value; it passes the pointer to the slider beneath. */
const TRACK_MARK: CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translate(-50%, -50%)",
  display: "flex",
  pointerEvents: "none",
};

/** The marks' footprint, ring included: about the thumb's own size, so the marks read at a glance beside it. */
const MARK_PX = 16;

/** Each mark's fill and the app-surface ring around it, from the theme's mark tokens. */
const MARK_PAINT = {
  held: {
    fill: RECKONING_MARK.held.color,
    stroke: "var(--color-surface-app)",
    strokeWidth: 3,
    paintOrder: "stroke",
  },
  modelled: {
    fill: RECKONING_MARK.modelled.color,
    stroke: "var(--color-surface-app)",
    strokeWidth: 3,
    strokeLinejoin: "round",
    paintOrder: "stroke",
  },
} satisfies Record<"held" | "modelled", CSSProperties>;

export const FIGURE: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
  minWidth: "36px",
  textAlign: "right",
};

const STEPPER_FIGURES: CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  justifyContent: "center",
  gap: "var(--gap-related)",
  fontVariantNumeric: "tabular-nums",
};

const MAIN_MARKED: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--gap-figure-parts)",
};

const SECONDARY: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--gap-figure-parts)",
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-faint)",
};
