import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { Button } from "../Button";
import { NULL_DISPLAY } from "../NullValue";
import { MODELLED_TO_SCET } from "../readingCurrency";
import { RECKONING_MARK } from "../reckoningMarkSpec";
import { Slider } from "../Slider";
import { VisuallyHidden } from "../VisuallyHidden";

/**
 * The figures a command control draws beside the value commanded: the value
 * the craft is expected to hold now, and the value it last reported while its
 * readings are held. Useful for a control that sets a value on a craft under
 * signal delay. Taken by {@link CommandSlider} and {@link CommandStepper}.
 *
 * @category Form
 */
export interface CommandValueProps {
  /** The value commanded, the same on every screen at the command centre; `null` while there is none. */
  commanded: number | null;
  /**
   * The value the craft is expected to hold now, at its own time, given every
   * command that has reached it. Drawn with the modelled mark wherever it
   * differs from `commanded`; `null` or equal to `commanded` draws nothing.
   */
  expected?: number | null;
  /** What the modelled mark says, spoken and shown on hover. Defaults to the kit's "modelled to SCET". */
  expectedCaption?: string;
  /**
   * The value the craft last reported, passed only while its readings are
   * held: drawn with the held mark wherever it differs from `commanded`.
   */
  lastSeen?: number | null;
  /** What the held mark says, spoken and shown on hover. */
  lastSeenCaption?: string;
  /** Called with the value the operator sets. */
  onChange: (value: number) => void;
  /** The lowest value the control sets. */
  min: number;
  /** The highest value the control sets. */
  max: number;
  /** The size of one step, and the closest two values may be before they share a position. */
  step: number;
  /** Draws a value as its figure, with its unit. */
  figure: (value: number) => ReactNode;
  /** Draws the control dark and refuses input. */
  disabled?: boolean;
  /** Why the control is disabled, shown as its tip. */
  disabledReason?: string;
}

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
 * kit's. Used by {@link CommandSlider} and {@link CommandStepper}.
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
 * A slider for a value a craft holds, such as a throttle, drawn the same on
 * every screen at the command centre. The thumb and its figure are the value
 * commanded. The modelled triangle on the track marks the value the craft is
 * expected to hold now, and the held square the value it last reported while
 * its readings are held. Useful for setting a craft's value under signal
 * delay without the control reading as the craft's own. Used by the Navball's
 * throttle.
 *
 * @category Form
 */
export function CommandSlider({
  "aria-label": ariaLabel,
  ...props
}: CommandValueProps & { "aria-label": string }) {
  const {
    commanded,
    expectedCaption = MODELLED_TO_SCET,
    lastSeenCaption = "last reported",
    onChange,
    min,
    max,
    step,
    figure,
    disabled,
  } = props;
  // The thumb follows the hand while it is held, whatever the queue says.
  const [hand, setHand] = useState<number | null>(null);
  useEffect(() => {
    if (hand === null) return;
    const end = () => setHand(null);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [hand]);
  const shown = hand ?? commanded;
  const marks = commandValueMarks({ ...props, commanded: shown });
  const at = (v: number) =>
    `calc(8px + ${(v - min) / (max - min || 1)} * (100% - 16px))`;
  return (
    <div style={ROW}>
      <div style={TRACK}>
        <Slider
          min={min}
          max={max}
          step={step}
          value={shown ?? min}
          onPointerDown={() => setHand(shown ?? min)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (hand !== null) setHand(v);
            onChange(v);
          }}
          disabled={disabled}
          aria-label={ariaLabel}
          style={FULL_WIDTH}
        />
        {marks.expected !== null && (
          <TrackMark
            kind="modelled"
            caption={expectedCaption}
            left={at(marks.expected)}
          />
        )}
        {marks.lastSeen !== null && (
          <TrackMark
            kind="held"
            caption={lastSeenCaption}
            left={at(marks.lastSeen)}
          />
        )}
      </div>
      <span style={FIGURE}>
        {shown === null ? NULL_DISPLAY : figure(shown)}
      </span>
    </div>
  );
}

/**
 * The held square or modelled triangle a command control draws, in the kit's
 * mark hues, ringed in the app surface so it stays distinct on the slider's
 * fill and on its bare track alike.
 */
function MarkShape({ kind }: { kind: "held" | "modelled" }) {
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
function TrackMark({
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
function MarkedFigure({
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

/**
 * A − / + stepper for a value a craft holds, such as a rotor's RPM cap, drawn
 * the same on every screen at the command centre. Its figure is the value
 * commanded and each press steps from it. Beside it, a figure marked modelled
 * is the value the craft is expected to hold now, and one marked held the
 * value it last reported while its readings are held. Useful for setting a
 * craft's value under signal delay without the control reading as the
 * craft's own. Used by the Rotor Tachometer.
 *
 * @category Form
 */
export function CommandStepper({
  lowerLabel,
  raiseLabel,
  unknown,
  ...props
}: CommandValueProps & {
  /** What the figure reads while there is no value at all, such as "RPM cap unknown". Defaults to the kit's null placeholder. */
  unknown?: ReactNode;
  /** The accessible name of the − button. */
  lowerLabel: string;
  /** The accessible name of the + button. */
  raiseLabel: string;
}) {
  const {
    commanded,
    expectedCaption = MODELLED_TO_SCET,
    lastSeenCaption = "last reported",
    onChange,
    min,
    max,
    step,
    figure,
    disabled,
    disabledReason,
  } = props;
  const marks = commandValueMarks(props);
  const press = (dir: 1 | -1) => {
    if (commanded === null) return;
    onChange(Math.min(max, Math.max(min, commanded + dir * step)));
  };
  const blocked = disabled || commanded === null;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        aria-label={lowerLabel}
        disabled={blocked}
        disabledReason={disabledReason}
        onClick={() => press(-1)}
      >
        −
      </Button>
      <span style={STEPPER_FIGURES}>
        {commanded === null ? (
          <span>{unknown ?? NULL_DISPLAY}</span>
        ) : marks.onCommanded ? (
          <MarkedFigure kind="held" caption={lastSeenCaption} main>
            {figure(commanded)}
          </MarkedFigure>
        ) : (
          <span>{figure(commanded)}</span>
        )}
        {marks.expected !== null && (
          <MarkedFigure kind="modelled" caption={expectedCaption}>
            {figure(marks.expected)}
          </MarkedFigure>
        )}
        {marks.lastSeen !== null && !marks.onCommanded && (
          <MarkedFigure kind="held" caption={lastSeenCaption}>
            {figure(marks.lastSeen)}
          </MarkedFigure>
        )}
      </span>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        aria-label={raiseLabel}
        disabled={blocked}
        disabledReason={disabledReason}
        onClick={() => press(1)}
      >
        +
      </Button>
    </>
  );
}

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-related)",
};

const TRACK: CSSProperties = {
  flex: 1,
  position: "relative",
  display: "flex",
  alignItems: "center",
};

const FULL_WIDTH: CSSProperties = { width: "100%" };

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

const FIGURE: CSSProperties = {
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
