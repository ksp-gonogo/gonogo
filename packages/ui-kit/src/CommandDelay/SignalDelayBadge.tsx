import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { Unit } from "../Unit";
import { withDelayCurrency } from "./delayCurrency";

/**
 * How long it takes to REACH the other end, as one small chip.
 *
 * ONE-WAY, because the operator's question is when their words land; the
 * round trip is what the strip draws for a message actually crossing. Drawn
 * beside a control that sends across the gap, so the light time is read before
 * the press rather than learned after it.
 */
export interface SignalDelayBadgeProps {
  /** One-way separation in seconds. Rendered as-is; the caller decides IF. */
  oneWaySeconds: number;
  /** The delay as the reading it arrived in, so a quiet `comms.delay` draws the figure held. */
  delayReading?: Reading<Value<"s">> | null;
  /** So a caller can pin or re-tone it with `styled()`. */
  className?: string;
}

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
