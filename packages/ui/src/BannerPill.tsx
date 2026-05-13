import type { ReactNode } from "react";
import styled, { css } from "styled-components";

export interface BannerPillProps {
  /** CSS color (or var) driving border, text, and dot color. */
  accent: string;
  /**
   * Where to anchor the pill in the viewport. "top" is the legacy
   * top-center placement; "inline" lets the pill flow inside whatever
   * positioned parent it's placed in (used by BannerStack to lay
   * banners out as a vertical column in the bottom-right corner of
   * the viewport, just left of the FAB).
   *
   * Default: "inline" — every new caller should use the stack.
   */
  anchor?: "top" | "inline";
  /** Top offset in px when anchor === "top". Default: 12. */
  top?: number;
  /** Stack order (z-index). Default: 999. */
  zIndex?: number;
  /** Optional box-shadow glow override. */
  glow?: string;
  /** Whether the dot pulses (animated). Default: false. */
  pulse?: boolean;
  /** ARIA role. Default: "status". */
  role?: "status" | "alert";
  /** aria-live override; if omitted, derived from role. */
  ariaLive?: "polite" | "assertive";
  /** Optional click handler. When set the pill becomes button-like. */
  onClick?: () => void;
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
  anchor = "inline",
  top = 12,
  zIndex = 999,
  glow,
  pulse = false,
  role = "status",
  ariaLive,
  onClick,
  children,
}: BannerPillProps) {
  const liveValue = ariaLive ?? (role === "alert" ? "assertive" : "polite");
  if (anchor === "top") {
    return (
      <FixedPill
        $accent={accent}
        $top={top}
        $zIndex={zIndex}
        $glow={glow}
        role={role}
        aria-live={liveValue}
      >
        <Dot $accent={accent} $pulse={pulse} />
        {children}
      </FixedPill>
    );
  }
  return (
    <InlinePill
      as={onClick ? "button" : "div"}
      type={onClick ? "button" : undefined}
      $accent={accent}
      $glow={glow}
      $clickable={Boolean(onClick)}
      role={role}
      aria-live={liveValue}
      onClick={onClick}
    >
      <Dot $accent={accent} $pulse={pulse} />
      {children}
    </InlinePill>
  );
}

const FixedPill = styled.div<{
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

const InlinePill = styled.div<{
  $accent: string;
  $glow: string | undefined;
  $clickable: boolean;
}>`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(0, 0, 0, 0.88);
  border: 1px solid ${(p) => p.$accent};
  border-radius: 999px;
  color: ${(p) => p.$accent};
  font-size: var(--font-size-sm);
  letter-spacing: 0.08em;
  font-family: inherit;
  white-space: nowrap;
  cursor: ${(p) => (p.$clickable ? "pointer" : "default")};
  pointer-events: ${(p) => (p.$clickable ? "auto" : "none")};
  animation: bannerSlideIn 320ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  transform-origin: right center;
  will-change: transform, opacity;
  ${(p) => (p.$glow ? css`box-shadow: ${p.$glow};` : "")}

  &:focus-visible {
    outline: 2px solid ${(p) => p.$accent};
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }

  @keyframes bannerSlideIn {
    from {
      opacity: 0;
      transform: translateX(40px) scaleX(0.6);
    }
    60% {
      opacity: 1;
    }
    to {
      opacity: 1;
      transform: translateX(0) scaleX(1);
    }
  }
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
