import type { ReactNode } from "react";
import styled, { css } from "styled-components";

export interface BannerPillProps {
  /** CSS color (or var) driving border, text, and dot color. */
  accent: string;
  /** Distance from the top of the viewport, in px. Default: 12. */
  top?: number;
  /** Stack order. Default: 999. */
  zIndex?: number;
  /** Optional box-shadow glow override. */
  glow?: string;
  /** Whether the dot pulses (animated). Default: false. */
  pulse?: boolean;
  /** ARIA role. Default: "status". */
  role?: "status" | "alert";
  /** aria-live override; if omitted, derived from role. */
  ariaLive?: "polite" | "assertive";
  children: ReactNode;
}

/**
 * Fixed-position pill anchored to the top-center of the viewport. The shared
 * chrome for status banners — coloured dot + caller-supplied text — with a
 * severity colour driving border/text. Callers control top offset and z-index
 * so multiple pills can stack.
 */
export function BannerPill({
  accent,
  top = 12,
  zIndex = 999,
  glow,
  pulse = false,
  role = "status",
  ariaLive,
  children,
}: BannerPillProps) {
  const liveValue = ariaLive ?? (role === "alert" ? "assertive" : "polite");
  return (
    <Pill
      $accent={accent}
      $top={top}
      $zIndex={zIndex}
      $glow={glow}
      role={role}
      aria-live={liveValue}
    >
      <Dot $accent={accent} $pulse={pulse} />
      {children}
    </Pill>
  );
}

const Pill = styled.div<{
  $accent: string;
  $top: number;
  $zIndex: number;
  $glow: string | undefined;
}>`
  position: fixed;
  top: ${(p) => p.$top}px;
  left: 50%;
  transform: translateX(-50%);
  z-index: ${(p) => p.$zIndex};
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.82);
  border: 1px solid ${(p) => p.$accent};
  border-radius: 999px;
  color: ${(p) => p.$accent};
  font-size: var(--font-size-sm);
  letter-spacing: 0.12em;
  pointer-events: none;
  ${(p) => (p.$glow ? css`box-shadow: ${p.$glow};` : "")}
`;

const Dot = styled.span<{ $accent: string; $pulse: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(p) => p.$accent};
  flex-shrink: 0;

  ${(p) =>
    p.$pulse &&
    css`
      @media (prefers-reduced-motion: no-preference) {
        animation: status-pill-pulse 1.2s ease-in-out infinite;
      }
      @keyframes status-pill-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.35;
        }
      }
    `}
`;
