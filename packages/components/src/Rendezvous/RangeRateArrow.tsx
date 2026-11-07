/** Whether an arrow beside the range says if the target is closing or opening; one switch to take it out. */
export const RANGE_RATE_ARROW = true;

/** Below this range rate, metres per second, neither arrow is drawn. */
const RANGE_RATE_DEADBAND = 0.05;

/** A small arrow beside the range: down and green while closing, up and amber while opening. */
export function RangeRateArrow({
  closing,
}: Readonly<{ closing: number | undefined }>) {
  if (
    closing === undefined ||
    !Number.isFinite(closing) ||
    Math.abs(closing) < RANGE_RATE_DEADBAND
  ) {
    return null;
  }
  const closes = closing > 0;
  return (
    <svg
      data-range-rate={closes ? "closing" : "opening"}
      role="img"
      aria-label={closes ? "Closing" : "Opening"}
      width={9}
      height={11}
      viewBox="0 0 9 11"
      style={{ marginLeft: 4, verticalAlign: "-0.1em" }}
    >
      <path
        d={closes ? "M4.5 10L0.5 4.5H8.5Z" : "M4.5 1L0.5 6.5H8.5Z"}
        fill={closes ? "var(--color-accent-fg)" : "var(--color-warn-mark)"}
      />
    </svg>
  );
}
