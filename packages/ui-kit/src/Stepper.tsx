import { useCallback, useId } from "react";
import styled from "styled-components";
import { focusRing } from "./focusRing";

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
   * costs. */
  children?: React.ReactNode;
  "data-testid"?: string;
}

/**
 * A stepper over a FIXED ORDERED SET: eight step counts, four tolerances, five
 * quality levels. For a free quantity with a unit use `UnitInput`; for one
 * tuned by feel use `JogWheel`.
 *
 * Rendered as the ARIA spinbutton pattern. `aria-valuenow` carries the INDEX
 * rather than the value, because the members need not be evenly spaced;
 * `aria-valuetext` carries the formatted member, which is what gets announced.
 * Up and right step forward, down and left step back, Home and End go to the
 * ends.
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

  // A held value outside the set steps to an end, the only answer that needs no guess at the neighbour.
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
    min-height: 44px;
    min-width: 44px;
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
