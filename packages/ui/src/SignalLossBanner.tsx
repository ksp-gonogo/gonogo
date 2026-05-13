import styled from "styled-components";
import { BannerPill } from "./BannerPill";

export type SignalState = "connected" | "partial" | "lost";

export interface SignalLossBannerProps {
  state: SignalState;
  /** Milliseconds since the signal state left "connected". Ignored when state is "connected". */
  elapsedMs: number;
}

/**
 * Presentational banner for signal-state indication. Fixed-position pill at
 * the top of the viewport; renders nothing when signal is healthy. Meant to
 * be dropped at the root of each screen — no data wiring, pure props in.
 */
export function SignalLossBanner({ state, elapsedMs }: SignalLossBannerProps) {
  if (state === "connected") return null;

  const label = state === "lost" ? "SIGNAL LOSS" : "PARTIAL CONTROL";
  return (
    <BannerPill
      accent={SEVERITY_COLOR[state]}
      glow="0 0 12px rgba(255, 59, 48, 0.35)"
      pulse
    >
      <Label>{label}</Label>
      <Timer>T+{formatElapsed(elapsedMs)}</Timer>
    </BannerPill>
  );
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const SEVERITY_COLOR: Record<Exclude<SignalState, "connected">, string> = {
  lost: "var(--color-status-nogo-bg)",
  partial: "var(--color-status-warning-bg)",
};

const Label = styled.span`
  font-weight: 600;
`;

const Timer = styled.span`
  color: var(--color-text-primary);
  letter-spacing: 0.06em;
`;
