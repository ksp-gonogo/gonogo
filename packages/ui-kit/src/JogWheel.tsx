/**
 * JogWheel: a fine-grain tape scrubber against a fixed centre caret. A
 * relative, focusable value input for dialling a bounded number by small
 * increments: pointer-drag along its orientation axis, or keyboard
 * arrows/Home/End. Purely presentational and vanilla-safe (props only, no
 * gonogo data hooks), so it stays inside `@ksp-gonogo/ui-kit`'s
 * react + styled-components peer surface.
 *
 * Semantics: a real focusable `role="slider"` with
 * `aria-valuenow`/`aria-valuemin`/`aria-valuemax`/`aria-valuetext` +
 * `aria-orientation`; full keyboard operation (Arrow ±step, Home/End =
 * min/max). All emits are suppressed while `disabled`.
 */

import type { KeyboardEvent, PointerEvent } from "react";
import { useRef } from "react";
import styled from "styled-components";

export interface JogWheelProps {
  value: number;
  min: number;
  max: number;
  step: number;
  /** Drag/keyboard axis. Default "horizontal". */
  orientation?: "horizontal" | "vertical";
  onChange: (next: number) => void;
  /** Caret label formatter. Default `String(Math.round(v))`. */
  format?: (v: number) => string;
  ariaLabel: string;
  disabled?: boolean;
}

/** Pixels of pointer travel per `step` of value. */
const SENSITIVITY_PX_PER_STEP = 4;

/**
 * Pure clamp + quantise: move `value` by `deltaSteps` of `step` (fractional
 * deltaSteps welcome, for pointer drag), clamp to `[min,max]`, and snap to the
 * step grid measured from `min`.
 */
export function applyDelta(
  value: number,
  bounds: { min: number; max: number; step: number },
  deltaSteps: number,
): number {
  const { min, max, step } = bounds;
  const raw = value + deltaSteps * step;
  const clamped = Math.min(max, Math.max(min, raw));
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

export function JogWheel({
  value,
  min,
  max,
  step,
  orientation = "horizontal",
  onChange,
  format,
  ariaLabel,
  disabled = false,
}: JogWheelProps): JSX.Element {
  const bounds = { min, max, step };
  const drag = useRef<{ start: number; startValue: number } | null>(null);

  const label = format ? format(value) : String(Math.round(value));
  const fraction = max > min ? (value - min) / (max - min) : 0;

  const emit = (next: number): void => {
    if (disabled) return;
    if (next !== value) onChange(next);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = applyDelta(value, bounds, 1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = applyDelta(value, bounds, -1);
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    emit(next);
  };

  const axisPos = (e: PointerEvent<HTMLDivElement>): number =>
    orientation === "vertical" ? e.clientY : e.clientX;

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (disabled) return;
    drag.current = { start: axisPos(e), startValue: value };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (disabled || !drag.current) return;
    // Vertical: dragging UP (clientY decreases) should INCREASE the value.
    const travel =
      orientation === "vertical"
        ? drag.current.start - axisPos(e)
        : axisPos(e) - drag.current.start;
    const deltaSteps = travel / SENSITIVITY_PX_PER_STEP;
    emit(applyDelta(drag.current.startValue, bounds, deltaSteps));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <JogWheel__Root
      role="slider"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      $orientation={orientation}
      $disabled={disabled}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <JogWheel__Tape
        $orientation={orientation}
        style={
          orientation === "vertical"
            ? { transform: `translateY(${(0.5 - fraction) * 100}%)` }
            : { transform: `translateX(${(0.5 - fraction) * 100}%)` }
        }
        aria-hidden="true"
      />
      <JogWheel__Caret $orientation={orientation} aria-hidden="true" />
      <JogWheel__Label aria-hidden="true">{label}</JogWheel__Label>
    </JogWheel__Root>
  );
}

const JogWheel__Root = styled.div<{
  $orientation: "horizontal" | "vertical";
  $disabled: boolean;
}>`
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: ${(p) => (p.$orientation === "vertical" ? "40px" : "120px")};
  height: ${(p) => (p.$orientation === "vertical" ? "120px" : "40px")};
  padding: var(--space-4, 4px);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-xs, 2px);
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  cursor: ${(p) =>
    p.$disabled
      ? "not-allowed"
      : p.$orientation === "vertical"
        ? "ns-resize"
        : "ew-resize"};
  touch-action: none;
  user-select: none;
  opacity: ${(p) => (p.$disabled ? 0.5 : 1)};

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const JogWheel__Tape = styled.div<{ $orientation: "horizontal" | "vertical" }>`
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    ${(p) => (p.$orientation === "vertical" ? "0deg" : "90deg")},
    var(--color-border-subtle) 0 1px,
    transparent 1px ${(p) => (p.$orientation === "vertical" ? "8px" : "10px")}
  );
  opacity: 0.6;
  pointer-events: none;
`;

const JogWheel__Caret = styled.div<{ $orientation: "horizontal" | "vertical" }>`
  position: absolute;
  background: var(--color-accent-fg);
  pointer-events: none;
  ${(p) =>
    p.$orientation === "vertical"
      ? "left: 0; right: 0; height: 2px; top: 50%;"
      : "top: 0; bottom: 0; width: 2px; left: 50%;"}
`;

const JogWheel__Label = styled.span`
  /* Last DOM sibling over the absolute tape/caret: paints on top by source
     order in the same stacking context, so no z-index is needed. */
  position: relative;
  font-family: var(--font-family-mono, ui-monospace, monospace);
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-primary);
  background: var(--color-surface-raised);
  padding: 0 var(--space-2, 2px);
  pointer-events: none;
`;
