import { value } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { Unit } from "../Unit";

/**
 * How long it takes to REACH the other end, as one small chip.
 *
 * The badge half of `signalDelayPresentation`: `InFlightList` is the strip half
 * and this is what shows in its place when the separation is too short for a
 * countdown to be readable. Presentational, props-driven, no data hooks, the
 * same rule its neighbour in this folder follows.
 *
 * ## Why the ONE-WAY figure
 *
 * It used to say the round trip, and the round trip answers a different
 * question: when the acknowledgement gets back. The operator's is when their
 * words land. A crew four light-minutes out starts acting on an instruction the
 * moment it reaches them, and the four minutes after that are the console
 * waiting to hear about it, not the craft waiting to be told. Quoting eight
 * minutes made the reading twice the number that mattered.
 *
 * The round trip has not gone anywhere: it is what the strip draws, in two
 * legs, for a message that is actually crossing. That is where a two-leg figure
 * belongs, because there it names a specific message and an instant it lands.
 *
 * ## Placement is the CONSOLE's, not this chip's and not each caller's
 *
 * An inline chip with no position of its own, which is not the same as leaving
 * the position to whoever renders it. That was the arrangement, and the two
 * consoles that draw one used it to reach opposite answers: a character grid
 * pinned it in its own top corner, a column of prose put it in the composer row
 * beside Send. `ConsoleFrame`'s `corner` slot owns the placement for both now,
 * so this stays free of `position` and neither console gets to pick.
 */
export interface SignalDelayBadgeProps {
  /** One-way separation in seconds. Rendered as-is; the caller decides IF. */
  oneWaySeconds: number;
  /** So a caller can pin or re-tone it with `styled()`. */
  className?: string;
}

export function SignalDelayBadge({
  oneWaySeconds,
  className,
}: SignalDelayBadgeProps) {
  const oneWay = value("s", oneWaySeconds);
  return (
    /* `role="status"`, never `alert`: a separation is a standing condition of
       the link, not an event that should interrupt a screen reader. */
    <SignalDelayBadge__Chip
      className={className}
      role="status"
      aria-label="Signal delay"
    >
      one-way ~
      {/* `scale: "never"` and a decimal, because a delay is a READOUT rather
          than a countdown: the time ladder truncates to whole units, so 7.6 s
          would read as "7s". Above a minute the decimal is noise and the ladder
          takes over. */}
      <Unit
        value={oneWay}
        {...(oneWay.lessThan(60)
          ? { scale: "never" as const, decimals: 1 }
          : {})}
      />
    </SignalDelayBadge__Chip>
  );
}

const SignalDelayBadge__Chip = styled.div`
  /* Non-growing: it shares the console's corner row with whatever else is
     standing there, and the text is short by construction (the badge only ever
     shows a delay the strip has declined to draw). */
  flex: 0 0 auto;
  padding: var(--space-2) var(--space-8);
  font-family: monospace;
  font-size: var(--font-size-xs);
  white-space: nowrap;
  color: var(--color-text-muted);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
`;
