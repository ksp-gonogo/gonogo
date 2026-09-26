import { value } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { Unit } from "../Unit";

/**
 * How long it takes to REACH the other end, as one small chip: the badge half
 * of `signalDelayPresentation`, shown when the separation is too short for a
 * readable countdown.
 *
 * ONE-WAY, because the operator's question is when their words land; the
 * round trip is what the strip draws for a message actually crossing.
 *
 * `Console` owns its placement and is the only thing that draws one, so it is
 * not on the barrel.
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
    // Not a live region: the delay changes with every sample.
    <SignalDelayBadge__Chip
      className={className}
      role="group"
      aria-label="Signal delay"
    >
      one-way ~
      {/* A delay is a READOUT, not a countdown, so under a minute it keeps a decimal the ladder would truncate. */}
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
  padding: var(--inset-chip-readout);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-compact);
  white-space: nowrap;
  color: var(--color-text-muted);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
`;
