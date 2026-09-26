import type { ReactNode } from "react";
import styled from "styled-components";

export interface DimmedOverlayProps {
  /** Dims the children under a banner; when false they render with no wrapper at all. */
  show: boolean;
  /** Centered banner text. Required when `show` is true. */
  message?: string;
  /** Smaller secondary line for an actionable hint. */
  hint?: string;
  children: ReactNode;
}

/** Keeps a non-live widget's last render visible but de-emphasised, with a banner naming the missing context. */
export function DimmedOverlay({
  show,
  message,
  hint,
  children,
}: DimmedOverlayProps) {
  if (!show) {
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
  /* Snapped, not exact: this was 200ms ease-out. The duration is unchanged;
     the curve moves ease-out to ease, because the motion scale has no
     ease-out rung by design. On a 0.35-opacity dim that is not a read the
     operator takes anything from, so the snap is accepted rather than
     carved out. */
  transition: opacity var(--duration-slow) var(--ease-standard);
`;

const Banner = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: var(--color-surface-overlay, rgba(20, 22, 26, 0.92));
  border: 1px solid var(--color-surface-raised);
  border-radius: var(--radius-regular);
  /* Shares --inset-control's value and not its class: this is a message you
     read, not a box you press, and the token names the pressable family so
     that its coarse-pointer widening has somewhere to live. Same call as the
     pills in BannerPill; see the note there. */
  padding: var(--inset-pill);
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  align-items: center;
  text-align: center;
  max-width: 80%;
  pointer-events: auto;
  /* Sit above the dimmed children but not above modals. */
  z-index: 1;
`;

const BannerMessage = styled.span`
  font-size: var(--font-size-compact);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-primary);
`;

const BannerHint = styled.span`
  font-size: var(--font-size-caption);
  color: var(--color-text-faint);
  letter-spacing: 0.04em;
`;
