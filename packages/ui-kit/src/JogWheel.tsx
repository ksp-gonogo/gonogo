import type { KeyboardEvent, PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { focusRing } from "./focusRing";

/**
 * What displacement MEANS.
 *
 * - `offset`: where the handle sits is the value. Needs bounds
 * - `rate`: where the handle sits is the speed the value changes at, and it
 *   springs back to centre on release. Needs no bounds, for a value such as an
 *   instant years out
 *
 * @category Form
 */
export type JogWheelMode = "offset" | "rate";

interface JogWheelCommon {
  value: number;
  step: number;
  /** Drag/keyboard axis. Default "horizontal". */
  orientation?: "horizontal" | "vertical";
  onChange: (next: number) => void;
  /** Caret label formatter, also used as `aria-valuetext`. Default `String(Math.round(v))`; for a quantity, write it with {@link writeQuantity}. */
  format?: (v: number) => string;
  ariaLabel: string;
  disabled?: boolean;
  /**
   * Box width in CSS px. Defaults to 120 horizontal / 40 vertical. Clamped up
   * to {@link JOG_WHEEL_MIN_TARGET_PX}.
   */
  width?: number;
  /**
   * Box height in CSS px. Defaults to 40 horizontal / 120 vertical. Clamped up
   * to {@link JOG_WHEEL_MIN_TARGET_PX}.
   */
  height?: number;
}

/**
 * Props for {@link JogWheel}. In the default `offset` mode `min` and `max` are
 * required; in `rate` mode they are optional.
 *
 * @category Form
 */
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
 * The floor either axis is clamped up to: WCAG 2.2 SC 2.5.8 (Target Size,
 * Minimum) at AA. Drag range is unaffected by the box, since the wheel captures
 * the pointer.
 *
 * @category Form
 */
export const JOG_WHEEL_MIN_TARGET_PX = 24;

/**
 * Below this on the cross axis the 4px inset would clip the caret label.
 */
const COMPACT_CROSS_AXIS_PX = 32;

/** Default box, per orientation: the long axis first. */
const DEFAULT_LONG_PX = 120;
const DEFAULT_SHORT_PX = 40;

/**
 * Pure clamp + quantise: move `value` by `deltaSteps` of `step` (fractional
 * deltaSteps welcome, for pointer drag), clamp to `[min,max]`, and snap to the
 * step grid.
 *
 * The grid is anchored at `min`, so an unbounded control moves by exactly the
 * delta asked for and snaps to nothing: a grid measured from negative infinity
 * is NaN, and one from a substituted zero would make one press move by other
 * than one step.
 *
 * @category Form
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

/**
 * A fine-grain tape scrubber against a fixed centre caret, for dialling a
 * number by small increments by pointer drag along its axis or by keyboard
 * (arrow keys move one `step`, Home and End go to `min` and `max`). A
 * focusable `role="slider"`; nothing is emitted while `disabled`. Sized with
 * `width` and `height` in CSS px, as {@link Dial} and {@link Tape} are.
 *
 * Two limits:
 *
 * - The caret label and `aria-valuetext` are the same string, so a screen
 *   reader cannot be given a fuller value description than the face shows
 * - The drag axis is viewport-relative, so a wheel rotated with a CSS
 *   transform cannot be dragged along its drawn axis. Do not rotate it
 *
 * @example
 * ```tsx
 * <JogWheel
 *   ariaLabel="Gain"
 *   value={gain}
 *   min={0}
 *   max={100}
 *   step={1}
 *   onChange={setGain}
 * />
 * ```
 *
 * @category Form
 */
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
    width,
    height,
  } = props;
  const vertical = orientation === "vertical";
  const boxWidth = Math.max(
    JOG_WHEEL_MIN_TARGET_PX,
    width ?? (vertical ? DEFAULT_SHORT_PX : DEFAULT_LONG_PX),
  );
  const boxHeight = Math.max(
    JOG_WHEEL_MIN_TARGET_PX,
    height ?? (vertical ? DEFAULT_LONG_PX : DEFAULT_SHORT_PX),
  );
  const rate = props.mode === "rate";
  // A rate control has no ends, so its arithmetic runs unbounded rather than clamping to an invented pair.
  const lo = min ?? Number.NEGATIVE_INFINITY;
  const hi = max ?? Number.POSITIVE_INFINITY;
  const bounds = { min: lo, max: hi, step };
  const drag = useRef<{ start: number; startValue: number } | null>(null);
  // The latest value, so the interval does not close over the value the drag began at.
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
   * Cleaned up on release and on unmount, so it never drives a value nobody is
   * holding.
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
        // Nowhere to go in a mode with no ends, so the key does nothing rather than jumping to an infinity.
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
      // Displacement sets the speed, so nothing is emitted here: the ticking effect does the moving.
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
    // Springs back, so the value stops moving once the operator lets go.
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
      aria-valuenow={Number.isFinite(value) ? value : undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      $orientation={orientation}
      $disabled={disabled}
      $width={boxWidth}
      $height={boxHeight}
      $compact={(vertical ? boxWidth : boxHeight) < COMPACT_CROSS_AXIS_PX}
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
  $width: number;
  $height: number;
  $compact: boolean;
}>`
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  width: ${(p) => p.$width}px;
  height: ${(p) => p.$height}px;
  padding: ${(p) =>
    p.$compact ? "var(--inset-jog-wheel-compact)" : "var(--inset-jog-wheel)"};
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
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

  ${focusRing}
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
  /* Last DOM sibling, so it paints over the absolute tape and caret without a z-index. */
  position: relative;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-compact);
  color: var(--color-text-primary);
  background: var(--color-surface-raised);
  padding: var(--inset-jog-wheel-label);
  pointer-events: none;
`;
