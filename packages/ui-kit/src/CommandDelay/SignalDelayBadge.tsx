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
 * ## Placement is the caller's
 *
 * An inline chip with no position of its own. A character grid whose top corner
 * is usually empty cells pins it there with `styled()`; a console over a column
 * of prose has no free corner and puts it in the composer row instead, next to
 * the control whose cost it is. Owning the position here would force one of
 * those two on the other.
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
  /* Non-growing: in a composer row it must not take width from the input it
     sits beside, and the text is short by construction (the badge only ever
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
