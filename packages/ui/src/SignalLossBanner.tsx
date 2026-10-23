import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { AwaitingSignal, Unit } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { BannerPill } from "./BannerPill";

export type SignalState = "connected" | "partial" | "lost" | "awaiting";

export interface SignalLossBannerProps {
  state: SignalState;
  /** Game time since the signal state left "connected". Ignored when state is "connected". */
  elapsed: Value<"s">;
  /** Seconds until the first link report is expected, when the state is "awaiting" and the delay is known. */
  expectedIn?: number;
}

/**
 * Presentational banner for signal-state indication. Fixed-position pill at
 * the top of the viewport; renders nothing when signal is healthy. "awaiting"
 * is the first report still crossing the distance, which is not a lost link. Meant to
 * be dropped at the root of each screen, no data wiring, pure props in.
 */
export function SignalLossBanner({
  state,
  elapsed,
  expectedIn,
}: SignalLossBannerProps) {
  if (state === "connected") return null;
  if (state === "awaiting") {
    return (
      <BannerPill accent="var(--color-text-muted)">
        <Label>
          <AwaitingSignal expectedIn={expectedIn} />
        </Label>
      </BannerPill>
    );
  }

  const label = state === "lost" ? "SIGNAL LOSS" : "PARTIAL CONTROL";
  return (
    <BannerPill
      accent={SEVERITY_COLOR[state]}
      glow="0 0 12px rgba(255, 59, 48, 0.35)"
      pulse
    >
      <Label>{label}</Label>
      <Timer>
        T+
        <Unit value={elapsed} />
      </Timer>
    </BannerPill>
  );
}

const SEVERITY_COLOR: Record<"lost" | "partial", string> = {
  lost: "var(--color-nogo-mark)",
  partial: "var(--color-warn-mark)",
};

const Label = styled.span`
  font-weight: 600;
`;

const Timer = styled.span`
  color: var(--color-text-primary);
  letter-spacing: 0.06em;
`;
