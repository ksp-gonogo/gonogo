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
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

/**
 * What displacement MEANS.
 *
 * <p><b>offset</b>: where the handle sits is the value. Needs bounds, and is the
 * original behaviour.</p>
 *
 * <p><b>rate</b>: where the handle sits is the SPEED the value changes at, and
 * it springs back to centre on release. Needs no bounds at all, which is the
 * whole reason it exists: an instant is legitimately years out, and no pair of
 * bounds spans that while leaving useful precision anywhere inside it. The
 * producer's own planner drives time and Δv this way.</p>
 */
export type JogWheelMode = "offset" | "rate";

interface JogWheelCommon {
  value: number;
  step: number;
  /** Drag/keyboard axis. Default "horizontal". */
  orientation?: "horizontal" | "vertical";
  onChange: (next: number) => void;
  /** Caret label formatter. Default `String(Math.round(v))`. */
  format?: (v: number) => string;
  ariaLabel: string;
  disabled?: boolean;
}

export type JogWheelProps =
  | (JogWheelCommon & {
      mode?: "offset";
      min: number;
      max: number;
    })
  | (JogWheelCommon & {
      mode: "rate";
      /** Optional here: a rate control does not need somewhere to stop. */
      min?: number;
      max?: number;
      /**
       * How many `step`s per second at FULL displacement. The travel between
       * centre and full is what gives the fine end of the range, so this sets
       * the coarse end.
       */
      stepsPerSecond?: number;
    });

/** Pixels of pointer travel per `step` of value. */
const SENSITIVITY_PX_PER_STEP = 4;

/** Pointer travel from centre to FULL rate, in rate mode. */
const RATE_TRAVEL_PX = 80;

/** How often a held rate control emits, in ms. */
const RATE_TICK_MS = 60;

/** Default steps per second at full displacement. */
const DEFAULT_STEPS_PER_SECOND = 30;

/**
 * Pure clamp + quantise: move `value` by `deltaSteps` of `step` (fractional
 * deltaSteps welcome, for pointer drag), clamp to `[min,max]`, and snap to the
 * step grid.
 *
 * <p>The grid is anchored at `min`, and a control with no minimum has no anchor,
 * so an UNBOUNDED one moves by exactly the delta asked for and snaps to nothing.
 * Two reasons. Measuring the grid from negative infinity produces NaN, which
 * does not throw, does not compare unequal to anything, and reaches the value as
 * a burn instant that is not a number while the control merely appears not to
 * respond. And measuring it from a substituted zero would make one arrow press
 * on an off-grid instant move by something other than one step, which is a nudge
 * control that cannot be trusted to nudge.</p>
 */
export function applyDelta(
  value: number,
  bounds: { min: number; max: number; step: number },
  deltaSteps: number,
): number {
  const { min, max, step } = bounds;
  const raw = value + deltaSteps * step;
  const clamped = Math.min(max, Math.max(min, raw));
  if (!Number.isFinite(min)) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

export function JogWheel(props: JogWheelProps): JSX.Element {
  const {
    value,
    min,
    max,
    step,
    orientation = "horizontal",
    onChange,
    format,
    ariaLabel,
    disabled = false,
  } = props;
  const rate = props.mode === "rate";
  // A rate control has no ends, so its arithmetic runs unbounded. `applyDelta`
  // clamps, and clamping to an invented pair is exactly what this mode exists
  // to avoid.
  const lo = min ?? Number.NEGATIVE_INFINITY;
  const hi = max ?? Number.POSITIVE_INFINITY;
  const bounds = { min: lo, max: hi, step };
  const drag = useRef<{ start: number; startValue: number } | null>(null);
  // The latest value, for the ticking effect below: it runs on an interval and
  // would otherwise close over whatever `value` was when the drag began, so
  // every tick would restate the same number.
  const latest = useRef(value);
  latest.current = value;
  const [displacement, setDisplacement] = useState(0);

  const label = format ? format(value) : String(Math.round(value));
  const fraction =
    hi > lo && Number.isFinite(hi - lo) ? (value - lo) / (hi - lo) : 0.5;

  const emit = (next: number): void => {
    if (disabled) return;
    if (next !== value) onChange(next);
  };

  /**
   * While the handle is off centre, move the value at a speed set by how far.
   *
   * <p>Cleaned up on release AND on unmount. A timer that outlived either would
   * keep driving a value nobody is holding, which for a flight plan means a burn
   * instant sliding while the operator is looking somewhere else.</p>
   */
  useEffect(() => {
    if (!rate || displacement === 0 || disabled) return;
    const perSecond =
      (props.mode === "rate" ? props.stepsPerSecond : undefined) ??
      DEFAULT_STEPS_PER_SECOND;
    const timer = setInterval(() => {
      const moved =
        latest.current +
        displacement * perSecond * step * (RATE_TICK_MS / 1000);
      onChange(moved);
    }, RATE_TICK_MS);
    return () => clearInterval(timer);
  }, [rate, displacement, disabled, step, onChange, props]);

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
        // Nowhere to go in a mode with no ends, so the key does nothing rather
        // than jumping to an infinity.
        if (!Number.isFinite(lo)) return;
        next = lo;
        break;
      case "End":
        if (!Number.isFinite(hi)) return;
        next = hi;
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
    if (rate) {
      // Displacement sets the SPEED, so nothing is emitted here: the ticking
      // effect does the moving, and a value that also jumped with the pointer
      // would be driven by two things at once.
      const fractionOfFull = travel / RATE_TRAVEL_PX;
      setDisplacement(Math.max(-1, Math.min(1, fractionOfFull)));
      return;
    }
    const deltaSteps = travel / SENSITIVITY_PX_PER_STEP;
    emit(applyDelta(drag.current.startValue, bounds, deltaSteps));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    drag.current = null;
    // Springs back to centre: a rate control left displaced would keep moving
    // the value after the operator let go of it.
    setDisplacement(0);
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
