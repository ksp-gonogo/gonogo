import type { ValueCommand } from "@ksp-gonogo/sitrep-sdk";
import { type ReactNode, useId } from "react";
import styled from "styled-components";
import {
  type CommandEdgeAttributes,
  useCommandInput,
} from "./CommandButton/commandInput";
import { MarkedFigure } from "./CommandValue/CommandValue";
import { COMMAND_WORD_ROOM, commandEdge } from "./commandEdge";
import { focusRing } from "./focusRing";
import { LiveRegion } from "./LiveRegion";
import { NULL_DISPLAY } from "./NullValue";
import { MODELLED_TO_SCET } from "./readingCurrency";
import { Tooltip } from "./Tooltip";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * The props every {@link Stepper} takes. Useful for letting the operator move
 * one member at a time through a closed set, or a number by a fixed step.
 *
 * @category Form
 */
export interface StepperBaseProps<Option> {
  /** Names the quantity for a screen reader, and both step controls take their
   * own names from it. */
  label: string;
  /** How a value reads. Defaults to `String`, which suits a plain integer; for
   * a member carrying a unit, write it with {@link writeQuantity}. */
  format?: (value: Option) => string;
  /** Sits under the value, for the sentence that explains what the setting
   * costs. */
  children?: ReactNode;
  /** A test id for the element holding the value and both step controls. */
  "data-testid"?: string;
}

/**
 * The values a {@link Stepper} steps through: a closed set, in the order it
 * steps through them (ascending by convention, because the increment control
 * is drawn on the right and reads as "more"), or a number range by a fixed step.
 *
 * @category Form
 */
export type StepperSteps<Option> =
  | {
      /** The values in the order the stepper moves through them. */
      options: readonly Option[];
      min?: never;
      max?: never;
      step?: never;
    }
  | {
      options?: never;
      /** The lowest value; absent, the stepper has no lower end. */
      min?: Option extends number ? number : never;
      /** The highest value; absent, the stepper has no upper end. */
      max?: Option extends number ? number : never;
      /** The size of one step, and the closest two values may be before they share a position. */
      step: Option extends number ? number : never;
    };

/**
 * What a {@link Stepper} draws beside the value held: the value a craft is
 * expected to hold now, and the value it last reported while its readings are
 * held.
 *
 * @category Form
 */
export interface StepperMarks<Option> {
  /** The value the craft is expected to hold now, at its own time. Drawn with the modelled mark where it differs from `value`. */
  expected?: Option | null;
  /** The value the craft last reported, passed only while its readings are held. Drawn with the held mark; equal to `value`, it marks the figure itself. */
  lastSeen?: Option | null;
  /** What the held mark says, spoken and shown on hover. Defaults to "last reported". */
  lastSeenCaption?: string;
  /** What the figure reads while there is no value at all. Defaults to the kit's null placeholder. */
  unknown?: ReactNode;
  /**
   * The value the first step lands on while there is no value at all, in either
   * direction. Defaults to the first option, or to the lowest value of a range
   * (zero where the range has no lower end, kept within its upper end).
   */
  startAt?: Option;
}

/**
 * The props of a {@link Stepper} that changes a value the caller holds.
 *
 * @category Form
 */
export type PlainStepperProps<Option> = StepperBaseProps<Option> &
  StepperSteps<Option> &
  StepperMarks<Option> & {
    /** The value now held. One not present in `options` reads as off the set: both step controls stay live and stepping lands on the nearest end. `null` reads as `unknown`, and the first step lands on `startAt`. */
    value: Option | null;
    /** Called with the value a step lands on. */
    onChange: (value: Option) => void;
    /** Shows the value with both step controls off. */
    disabled?: boolean;
    /** Why the stepper cannot be used now, such as an unread value, shown as its tip. */
    disabledReason?: string;
    command?: never;
    unavailable?: never;
  };

/**
 * The props of a {@link Stepper} that sends a command. `value` is the value the
 * vessel is commanded to hold, each press steps from it and is always sent, and
 * a word beside the figure says what became of the press.
 *
 * @category Form
 */
export type CommandedStepperProps<Option> = StepperBaseProps<Option> &
  StepperSteps<Option> &
  StepperMarks<Option> & {
    /** The command a step sends, made with `toArgs` on a `useCommand` handle and given the value stepped to. */
    // biome-ignore lint/suspicious/noExplicitAny: a command of any argument and reply types
    command: ValueCommand<Option, any, any>;
    /** The value commanded, the same on every screen at the command centre; `null` while there is none. */
    value: Option | null;
    /** Why the stepper cannot be used now. It is drawn dimmed with this as its tip and a step sends nothing. */
    unavailable?: string | null;
    onChange?: never;
    disabled?: never;
  };

/**
 * Props for {@link Stepper}.
 *
 * @category Form
 */
export type StepperProps<Option> =
  | PlainStepperProps<Option>
  | CommandedStepperProps<Option>;

interface StepperViewProps<Option> {
  steps: StepperSteps<Option>;
  value: Option | null;
  onChange: (value: Option) => void;
  label: string;
  format: (value: Option) => string;
  disabled: boolean;
  marks: StepperMarks<Option>;
  children?: ReactNode;
  "data-testid"?: string;
  edge?: CommandEdgeAttributes;
  tip?: string;
  /** Drawn in the value box after the figures. */
  trailing?: ReactNode;
}

/**
 * A − / value / + control for moving one member at a time through a closed set
 * of values, or a number by a fixed step. Useful for a setting whose legal values
 * are few and ordered (a physics step count, a delay mode) or a limit set a step
 * at a time (a rotor's RPM cap). Given a `command`, each press steps from the
 * value commanded and sends it, with the value the craft is expected to hold and
 * the one it last reported drawn beside it. Used by the Rotor Tachometer. The
 * value is a spinbutton, so the arrow keys, Home and End step it.
 *
 * @category Form
 */
export function Stepper<Option>(props: StepperProps<Option>) {
  if (props.command) {
    return <CommandedStepper {...props} command={props.command} />;
  }
  return (
    <StepperView
      steps={props}
      value={props.value}
      onChange={props.onChange}
      label={props.label}
      format={props.format ?? String}
      disabled={props.disabled ?? false}
      marks={props}
      data-testid={props["data-testid"]}
      tip={
        props.disabled || props.value === null
          ? props.disabledReason
          : undefined
      }
    >
      {props.children}
    </StepperView>
  );
}

function CommandedStepper<Option>(props: CommandedStepperProps<Option>) {
  const { command, unavailable, value } = props;
  const format = props.format ?? String;
  const input = useCommandInput({ command, unavailable });
  return (
    <StepperView
      steps={props}
      value={value}
      onChange={input.send}
      label={props.label}
      format={format}
      disabled={input.inert}
      marks={props}
      data-testid={props["data-testid"]}
      edge={input.edge}
      tip={input.tip}
      trailing={
        <>
          <StepperWord aria-hidden="true">{input.word}</StepperWord>
          <LiveRegion visuallyHidden>{input.announce}</LiveRegion>
        </>
      }
    >
      {props.children}
    </StepperView>
  );
}

/* Holds the room of the longest word at rest too, so the group never changes width. */
const StepperWord = styled.span`
  display: inline-block;
  min-width: ${COMMAND_WORD_ROOM};
  text-align: start;
  margin-inline-start: var(--gap-related);
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.08em;
`;

/* With a reason to give, aria-disabled and not disabled, so a dimmed step keeps focus and its reason can be reached. */
function stepState(
  inert: boolean,
  reasonId: string,
  reason: string | undefined,
) {
  if (reason === undefined) return { disabled: inert };
  return {
    "aria-disabled": inert || undefined,
    "aria-describedby": inert ? reasonId : undefined,
  };
}

function StepperView<Option>({
  steps,
  value,
  onChange,
  label,
  format,
  disabled,
  marks,
  children,
  "data-testid": testId,
  edge,
  tip,
  trailing,
}: StepperViewProps<Option>) {
  const describedBy = useId();
  const reasonId = useId();
  const options = steps.options;
  const range = options === undefined;
  const numeric = typeof value === "number" ? value : null;
  const lowest = range ? (steps.min ?? Number.NEGATIVE_INFINITY) : 0;
  const highest = range
    ? (steps.max ?? Number.POSITIVE_INFINITY)
    : Math.max((options?.length ?? 0) - 1, 0);
  const index = options && value !== null ? options.indexOf(value) : -1;
  const atStart = range
    ? numeric !== null && numeric <= lowest
    : index >= 0 && index <= 0;
  const atEnd = range
    ? numeric !== null && numeric >= highest
    : index >= 0 && index >= (options?.length ?? 0) - 1;

  const land = (next: Option | undefined) => {
    if (disabled || next === undefined || next === value) return;
    onChange(next);
  };
  /* With no value at all, any step lands on the same starting value, since there is no neighbour to step to. */
  const start = (): Option | undefined => {
    if (marks.startAt !== undefined) return marks.startAt;
    if (options) return options[0];
    return Math.min(highest, Math.max(lowest, 0)) as Option;
  };
  // A held value outside the set steps to an end, the only answer that needs no guess at the neighbour.
  const toward = (dir: -1 | 1): Option | undefined => {
    if (value === null) return start();
    if (options) {
      if (options.length === 0) return undefined;
      const to = index < 0 ? (dir === 1 ? options.length - 1 : 0) : index + dir;
      return options[Math.min(Math.max(to, 0), options.length - 1)];
    }
    if (numeric === null) return undefined;
    const by = (steps.step ?? 0) * dir;
    return Math.min(highest, Math.max(lowest, numeric + by)) as Option;
  };
  const end = (which: "start" | "end"): Option | undefined => {
    if (value === null) return start();
    if (options) return options[which === "start" ? 0 : options.length - 1];
    const bound = which === "start" ? lowest : highest;
    return Number.isFinite(bound) ? (bound as Option) : undefined;
  };

  const modelled =
    marks.expected === null ||
    marks.expected === undefined ||
    marks.expected === value
      ? null
      : marks.expected;
  const held = marks.lastSeen ?? null;
  const showsHeldFigure =
    marks.lastSeen !== undefined &&
    marks.lastSeen !== null &&
    marks.lastSeen === value;
  return (
    <Tooltip text={tip}>
      <Stepper__Body data-testid={testId}>
        <Stepper__Step
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => land(toward(-1))}
          {...stepState(disabled || atStart, reasonId, tip)}
        >
          −
        </Stepper__Step>
        <Stepper__Value
          {...edge}
          role="spinbutton"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-valuenow={
            value === null
              ? undefined
              : range
                ? (numeric ?? undefined)
                : index < 0
                  ? undefined
                  : index
          }
          aria-valuemin={Number.isFinite(lowest) ? lowest : undefined}
          aria-valuemax={Number.isFinite(highest) ? highest : undefined}
          aria-valuetext={value === null ? undefined : format(value)}
          aria-disabled={disabled || edge?.["aria-disabled"] || undefined}
          aria-describedby={children == null ? undefined : describedBy}
          onKeyDown={(event) => {
            switch (event.key) {
              case "ArrowUp":
              case "ArrowRight":
                event.preventDefault();
                land(toward(1));
                break;
              case "ArrowDown":
              case "ArrowLeft":
                event.preventDefault();
                land(toward(-1));
                break;
              case "Home":
                event.preventDefault();
                land(end("start"));
                break;
              case "End":
                event.preventDefault();
                land(end("end"));
                break;
              default:
                break;
            }
          }}
        >
          {value === null ? (
            (marks.unknown ?? NULL_DISPLAY)
          ) : showsHeldFigure ? (
            <MarkedFigure
              kind="held"
              caption={marks.lastSeenCaption ?? "last reported"}
              main
            >
              {format(value)}
            </MarkedFigure>
          ) : (
            format(value)
          )}
          {modelled !== null && (
            <MarkedFigure kind="modelled" caption={MODELLED_TO_SCET}>
              {format(modelled)}
            </MarkedFigure>
          )}
          {held !== null && held !== value && (
            <MarkedFigure
              kind="held"
              caption={marks.lastSeenCaption ?? "last reported"}
            >
              {format(held)}
            </MarkedFigure>
          )}
          {trailing}
        </Stepper__Value>
        <Stepper__Step
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => land(toward(1))}
          {...stepState(disabled || atEnd, reasonId, tip)}
        >
          +
        </Stepper__Step>
        {tip !== undefined && (
          <VisuallyHidden id={reasonId}>{tip}</VisuallyHidden>
        )}
        {children != null && (
          <Stepper__Note id={describedBy}>{children}</Stepper__Note>
        )}
      </Stepper__Body>
    </Tooltip>
  );
}

const Stepper__Body = styled.div`
  display: inline-grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--gap-stepper);
`;

const Stepper__Step = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--size-stepper-button);
  font-family: inherit;
  font-size: var(--font-size-compact);
  font-weight: 600;
  line-height: var(--line-height-flush);
  padding: var(--inset-stepper);
  border-radius: var(--radius-regular);
  cursor: pointer;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-muted);

  @media (hover: hover) {
    &:hover:not(:disabled) {
      border-color: var(--color-text-faint);
      color: var(--color-text-primary);
    }
  }

  ${focusRing}

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @media (pointer: coarse) {
    min-height: var(--touch-target);
    min-width: var(--touch-target);
  }
`;

const Stepper__Value = styled.div`
  text-align: center;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-value);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
  padding: var(--inset-stepper);
  border-radius: var(--radius-regular);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-sunken);
  white-space: nowrap;
  ${commandEdge}

  ${focusRing}

  &[aria-disabled="true"] {
    opacity: 0.4;
  }
`;

const Stepper__Note = styled.div`
  grid-column: 1 / -1;
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
`;
