import { useCallback, useId } from "react";
import styled from "styled-components";

export interface StepperProps<T> {
  /**
   * The values this control may hold, in the order it steps through them.
   * Ascending is the convention, because the increment control is drawn on the
   * right and reads as "more".
   */
  options: readonly T[];
  /** The value now held. One not present in `options` reads as off the set:
   * both step controls stay live and stepping lands on the nearest end. */
  value: T;
  onChange: (value: T) => void;
  /** Names the quantity for a screen reader, and both step controls take their
   * own names from it. */
  label: string;
  /** How a value reads. Defaults to `String`, which is right for a plain
   * integer and wrong for anything carrying a unit. */
  format?: (value: T) => string;
  disabled?: boolean;
  /** Sits under the value, for the sentence that explains what the setting
   * costs. Not a tooltip: the reason to change a setting should not be hidden
   * behind a hover. */
  children?: React.ReactNode;
  "data-testid"?: string;
}

/**
 * A stepper over a FIXED ORDERED SET: eight step counts, four tolerances, five
 * quality levels. Not a number the operator may type and not a continuous
 * slider, because neither models a set whose only legal members are the ones
 * listed.
 *
 * Stepper, `UnitInput` or `JogWheel`? Three different quantities:
 *
 *   - Stepper holds one of a SMALL CLOSED SET, and the set is the point. Any
 *     value between two members is not merely unusual, it is not a value.
 *   - `UnitInput` holds a free quantity with a unit. Any number in range is
 *     legal and the operator usually knows the one they want.
 *   - `JogWheel` holds a quantity being tuned by feel, where the interesting
 *     thing is the RATE of change rather than the value typed.
 *
 * Rendered as the ARIA spinbutton pattern, which is what a stepper is: the
 * readout carries `role="spinbutton"` and the arithmetic, the two buttons beside
 * it are ordinary buttons that drive it. `aria-valuenow` carries the INDEX
 * rather than the value, because the members need not be evenly spaced and a
 * screen reader announcing "1048576 of 8" would be nonsense; `aria-valuetext`
 * carries the formatted member, which is what actually gets announced.
 *
 * Keyboard, per the pattern: up and right step forward, down and left step back,
 * Home and End go to the ends.
 */
export function Stepper<T>({
  options,
  value,
  onChange,
  label,
  format = String,
  disabled = false,
  children,
  "data-testid": testId,
}: StepperProps<T>) {
  const describedBy = useId();
  const index = options.indexOf(value);
  const atStart = index <= 0;
  const atEnd = index >= options.length - 1;

  const step = useCallback(
    (to: number) => {
      if (disabled || options.length === 0) {
        return;
      }
      const clamped = Math.min(Math.max(to, 0), options.length - 1);
      const next = options[clamped];
      if (next !== value) {
        onChange(next);
      }
    },
    [disabled, onChange, options, value],
  );

  // An index of -1 means the held value is not in the set. Stepping from there
  // has to land somewhere, and the ends are the only two answers that need no
  // guess about which neighbour was meant.
  const back = () => step(index < 0 ? 0 : index - 1);
  const forward = () => step(index < 0 ? options.length - 1 : index + 1);

  return (
    <Stepper__Body data-testid={testId}>
      <Stepper__Step
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={back}
        disabled={disabled || (index >= 0 && atStart)}
      >
        −
      </Stepper__Step>
      <Stepper__Value
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={index < 0 ? undefined : index}
        aria-valuemin={0}
        aria-valuemax={Math.max(options.length - 1, 0)}
        aria-valuetext={format(value)}
        aria-disabled={disabled || undefined}
        aria-describedby={children == null ? undefined : describedBy}
        onKeyDown={(event) => {
          switch (event.key) {
            case "ArrowUp":
            case "ArrowRight":
              event.preventDefault();
              forward();
              break;
            case "ArrowDown":
            case "ArrowLeft":
              event.preventDefault();
              back();
              break;
            case "Home":
              event.preventDefault();
              step(0);
              break;
            case "End":
              event.preventDefault();
              step(options.length - 1);
              break;
            default:
              break;
          }
        }}
      >
        {format(value)}
      </Stepper__Value>
      <Stepper__Step
        type="button"
        aria-label={`Increase ${label}`}
        onClick={forward}
        disabled={disabled || (index >= 0 && atEnd)}
      >
        +
      </Stepper__Step>
      {children != null && (
        <Stepper__Note id={describedBy}>{children}</Stepper__Note>
      )}
    </Stepper__Body>
  );
}

const Stepper__Body = styled.div`
  display: inline-grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-4, 4px);
`;

const Stepper__Step = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--space-24, 24px);
  font-family: inherit;
  font-size: var(--font-size-sm);
  font-weight: 600;
  line-height: 1;
  padding: var(--space-4, 4px) var(--space-8, 8px);
  border-radius: var(--radius-sm, 3px);
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

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @media (pointer: coarse) {
    min-height: 44px;
    min-width: 44px;
  }
`;

const Stepper__Value = styled.div`
  text-align: center;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
  padding: var(--space-4, 4px) var(--space-8, 8px);
  border-radius: var(--radius-sm, 3px);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-sunken);

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  &[aria-disabled="true"] {
    opacity: 0.4;
  }
`;

const Stepper__Note = styled.div`
  grid-column: 1 / -1;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;
