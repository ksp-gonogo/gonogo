import type { ValueCommand } from "@ksp-gonogo/sitrep-sdk";
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import styled from "styled-components";
import {
  type CommandInputState,
  useCommandInput,
} from "./CommandButton/commandInput";
import {
  commandValueMarks,
  FIGURE,
  FULL_WIDTH,
  ROW,
  TRACK,
  TrackMark,
} from "./CommandValue/CommandValue";
import { commandOutlineEdge } from "./commandEdge";
import { focusRing } from "./focusRing";
import { LiveRegion } from "./LiveRegion";
import { NULL_DISPLAY } from "./NullValue";
import { MODELLED_TO_SCET } from "./readingCurrency";
import { Tooltip } from "./Tooltip";

/**
 * A native range input's attributes, less the `type`, which a slider always is.
 * Useful for letting the operator adjust a level without typing a number. Taken
 * by {@link Slider}.
 *
 * @category Form
 */
export type PlainSliderProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  figure?: never;
  command?: never;
};

/**
 * The props of a {@link Slider} for a value a craft holds, such as a throttle.
 * `value` is the value commanded, the same on every screen at the command
 * centre, and `figure` draws it beside the track with its unit. A modelled
 * triangle on the track marks the value the craft is expected to hold now, and
 * a held square the value it last reported while its readings are held. With a
 * `command` the value is sent when the operator lets go, and a word beside the
 * figure says what became of it.
 *
 * @category Form
 */
export interface MarkedSliderProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "min" | "max" | "step" | "disabled"
  > {
  /** The value commanded; `null` while there is none. */
  value: number | null;
  /** The lowest value the slider sets. */
  min: number;
  /** The highest value the slider sets. */
  max: number;
  /** The size of one step, and the closest two values may be before they share a position. */
  step: number;
  /** Draws a value as its figure, with its unit. */
  figure: (value: number) => ReactNode;
  /** The value the craft is expected to hold now, at its own time. Drawn with the modelled mark wherever it differs from `value`. */
  expected?: number | null;
  /** What the modelled mark says, spoken and shown on hover. Defaults to the kit's "modelled to SCET". */
  expectedCaption?: string;
  /** The value the craft last reported, passed only while its readings are held. Drawn with the held mark wherever it differs from `value`. */
  lastSeen?: number | null;
  /** What the held mark says, spoken and shown on hover. */
  lastSeenCaption?: string;
  /** The command the value sends when the operator lets go, made with `toArgs` on a `useCommand` handle. Absent, `onChange` is called on every move. */
  // biome-ignore lint/suspicious/noExplicitAny: a command of any argument and reply types
  command?: ValueCommand<number, any, any>;
  /** Why the slider cannot be used now. It is drawn dimmed with this as its tip and nothing is sent. */
  unavailable?: string | null;
  /** Draws the slider dark and refuses input. */
  disabled?: boolean;
  /** The accessible name. */
  "aria-label": string;
}

/**
 * A native range slider in the kit's accent, for a value set by feel along a
 * fixed span (a throttle, a gain). Useful for letting the operator adjust a
 * level without typing a number. Used by the administration building's screens
 * and the Navball's throttle. It fills the width it is given; a plain slider
 * leaves the value it stands for to the caller, and one given a `figure` draws
 * it, with the marks for the values a craft is expected to hold and last
 * reported.
 *
 * @category Form
 */
export const Slider = forwardRef<
  HTMLInputElement,
  PlainSliderProps | MarkedSliderProps
>(function Slider(props, ref) {
  if (props.command) {
    return (
      <CommandedSlider {...props} command={props.command} forwardedRef={ref} />
    );
  }
  if (props.figure !== undefined) {
    return <MarkedSlider {...props} forwardedRef={ref} />;
  }
  return <Slider__Input ref={ref} type="range" {...props} />;
});

function CommandedSlider({
  command,
  unavailable,
  forwardedRef,
  ...props
}: MarkedSliderProps & {
  // biome-ignore lint/suspicious/noExplicitAny: a command of any argument and reply types
  command: ValueCommand<number, any, any>;
  forwardedRef: React.ForwardedRef<HTMLInputElement>;
}) {
  const input = useCommandInput({ command, unavailable });
  return (
    <MarkedSlider
      {...props}
      forwardedRef={forwardedRef}
      input={input}
      disabled={props.disabled}
    />
  );
}

function MarkedSlider({
  forwardedRef,
  input,
  value,
  min,
  max,
  step,
  figure,
  expected,
  expectedCaption = MODELLED_TO_SCET,
  lastSeen,
  lastSeenCaption = "last reported",
  disabled,
  onChange,
  "aria-label": ariaLabel,
  ...rest
}: Omit<MarkedSliderProps, "command" | "unavailable"> & {
  forwardedRef: React.ForwardedRef<HTMLInputElement>;
  input?: CommandInputState<number>;
}) {
  // A command sends its value when the hand lets go, so the thumb follows the hand meanwhile.
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
  const shown = hand ?? value;
  const marks = commandValueMarks({
    commanded: shown,
    expected,
    lastSeen,
    step,
  });
  const at = (v: number) =>
    `calc(8px + ${(v - min) / (max - min || 1)} * (100% - 16px))`;
  const send = (v: number) => {
    input?.send(v);
  };
  return (
    <div style={ROW}>
      <Tooltip text={input?.tip}>
        <div style={TRACK}>
          <Slider__Input
            {...rest}
            {...input?.edge}
            ref={forwardedRef}
            type="range"
            min={min}
            max={max}
            step={step}
            value={shown ?? min}
            onPointerDown={() => setHand(shown ?? min)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (hand !== null) setHand(v);
              else send(v);
              onChange?.(e);
            }}
            onPointerUp={(e) => send(Number(e.currentTarget.value))}
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
      </Tooltip>
      <span style={FIGURE}>
        {shown === null ? NULL_DISPLAY : figure(shown)}
        {input && <SliderWord aria-hidden="true">{input.word}</SliderWord>}
      </span>
      {input && <LiveRegion visuallyHidden>{input.announce}</LiveRegion>}
    </div>
  );
}

/* Holds the room of the longest word at rest too, so the track never changes length. */
const SliderWord = styled.span`
  display: inline-block;
  min-width: 7ch;
  margin-inline-start: var(--gap-related);
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.08em;
`;

const Slider__Input = styled.input`
  width: 100%;
  min-width: 0;
  margin: 0;
  background: none;
  accent-color: var(--color-accent-fg);
  cursor: pointer;

  ${focusRing}
  ${commandOutlineEdge}
  border-radius: var(--radius-pill);

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

/**
 * Props for {@link Slider}: a native range input's, or those of a slider that
 * draws a figure and the marks for a value a craft holds.
 *
 * @category Form
 */
export type SliderProps = PlainSliderProps | MarkedSliderProps;
