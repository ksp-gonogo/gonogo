import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { Unit } from "../Unit";
import { withDelayCurrency } from "./delayCurrency";

/**
 * Props for {@link SignalDelayBadge}.
 *
 * @category CommandDelay
 */
export interface SignalDelayBadgeProps {
  /** The one-way delay in seconds, drawn as given: the caller decides whether to render the badge at all. Under a minute it is written with one decimal. */
  oneWaySeconds: number;
  /** The delay as the reading it arrived in, so a quiet `comms.delay` draws the figure held. */
  delayReading?: Reading<Value<"s">> | null;
  /** So a caller can pin or re-tone it with `styled()`. */
  className?: string;
}

/**
 * The one-way delay between the active command centre and the vessel or device
 * a control sends to, as a small chip ("one-way ~4.2 s"). The figure is the
 * one its caller passes in `oneWaySeconds`. Useful for showing the operator
 * the expected time for a command to reach the target. Used alongside
 * time-sensitive controls like {@link Console} to help the operator
 * understand when a command is likely to happen.
 *
 * @category CommandDelay
 */
export function SignalDelayBadge({
  oneWaySeconds,
  delayReading,
  className,
}: SignalDelayBadgeProps) {
  const oneWay = value("s", oneWaySeconds);
  return (
    // Not a live region: the delay changes with every sample.
    <SignalDelayBadge__Chip
      className={className}
      role="group"
      aria-label="Signal delay"
    >
      one-way ~
      {/* A delay is a READOUT, not a countdown, so under a minute it keeps a decimal the ladder would truncate. */}
      <Unit
        value={withDelayCurrency(oneWay, delayReading)}
        {...(oneWay.lessThan(60)
          ? { scale: "never" as const, decimals: 1 }
          : {})}
      />
    </SignalDelayBadge__Chip>
  );
}

const SignalDelayBadge__Chip = styled.div`
  /* Non-growing: it shares the console's corner row, and its text is short by construction. */
  flex: 0 0 auto;
  padding: var(--inset-chip-readout);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-compact);
  white-space: nowrap;
  color: var(--color-text-muted);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
`;
