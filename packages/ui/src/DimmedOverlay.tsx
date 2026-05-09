import type { ReactNode } from "react";
import styled from "styled-components";

export interface DimmedOverlayProps {
  /**
   * When true, the children render dimmed and an overlay banner appears
   * on top with the message. When false, children render unchanged and
   * the wrapper is otherwise transparent — no DOM cost beyond a single
   * positioned div.
   */
  show: boolean;
  /** Centered banner text. Required when `show` is true. */
  message?: string;
  /**
   * Optional secondary line, rendered smaller below the message. Use for
   * actionable hints (e.g. "Launch from a station to see this").
   */
  hint?: string;
  children: ReactNode;
}

/**
 * Wraps any widget with a state-aware dim layer. Used to soften
 * "dead values" when a widget's underlying telemetry isn't live —
 * the existing render is preserved (last-good values, current layout)
 * but visibly de-emphasised, with a small banner explaining why.
 *
 * Live (`show=false`):  children render at full opacity, no overlay.
 * Inactive (`show=true`): children render at ~35% opacity (still
 * legible enough that the operator can verify shape but clearly not
 * authoritative); a centered banner identifies the missing context.
 *
 * Banner is `role="status" aria-live="polite"` so screen readers
 * announce the change without interrupting flow. The dimmed layer is
 * `aria-hidden` so its values don't compete with the banner.
 */
export function DimmedOverlay({
  show,
  message,
  hint,
  children,
}: DimmedOverlayProps) {
  if (!show) {
    // Render children directly — no wrapper means no styling drift on
    // the live path (avoids accidentally affecting layout / focus).
    return <>{children}</>;
  }
  return (
    <Wrap>
      <DimmedLayer aria-hidden="true">{children}</DimmedLayer>
      <Banner role="status" aria-live="polite">
        <BannerMessage>{message}</BannerMessage>
        {hint && <BannerHint>{hint}</BannerHint>}
      </Banner>
    </Wrap>
  );
}

const Wrap = styled.div`
  position: relative;
  width: 100%;
  /* flex: 1 lets the wrap participate in a flex-column parent (like Panel)
   * without forcing height: 100%, which would push siblings out of the
   * column. Falls back gracefully in non-flex contexts because min-height
   * doesn't bound. */
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const DimmedLayer = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  opacity: 0.35;
  pointer-events: none;
  filter: saturate(0.5);
  transition: opacity 200ms ease-out;
`;

const Banner = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: var(--color-surface-overlay, rgba(20, 22, 26, 0.92));
  border: 1px solid var(--color-surface-raised);
  border-radius: 3px;
  padding: 6px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  text-align: center;
  max-width: 80%;
  pointer-events: auto;
  /* Sit above the dimmed children but not above modals. */
  z-index: 1;
`;

const BannerMessage = styled.span`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-primary);
`;

const BannerHint = styled.span`
  font-size: 10px;
  color: var(--color-text-faint);
  letter-spacing: 0.04em;
`;
