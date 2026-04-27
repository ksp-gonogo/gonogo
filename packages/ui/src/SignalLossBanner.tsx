import styled from "styled-components";

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
    <Pill $severity={state} role="status" aria-live="polite">
      <Dot $severity={state} />
      <Label>{label}</Label>
      <Timer>T+{formatElapsed(elapsedMs)}</Timer>
    </Pill>
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

const Pill = styled.div<{ $severity: Exclude<SignalState, "connected"> }>`
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.82);
  border: 1px solid ${({ $severity }) => SEVERITY_COLOR[$severity]};
  border-radius: 999px;
  color: ${({ $severity }) => SEVERITY_COLOR[$severity]};
  font-size: var(--font-size-sm);
  letter-spacing: 0.12em;
  pointer-events: none;
  box-shadow: 0 0 12px rgba(255, 59, 48, 0.35);
`;

const Dot = styled.span<{ $severity: Exclude<SignalState, "connected"> }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $severity }) => SEVERITY_COLOR[$severity]};

  @media (prefers-reduced-motion: no-preference) {
    animation: signal-pulse 1.2s ease-in-out infinite;
  }

  @keyframes signal-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
`;

const Label = styled.span`
  font-weight: 600;
`;

const Timer = styled.span`
  color: var(--color-text-primary);
  letter-spacing: 0.06em;
`;
