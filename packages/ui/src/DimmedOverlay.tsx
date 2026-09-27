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
  /* Grows in a flex-column parent without height: 100%, which would push siblings out. */
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
  transition: opacity var(--duration-slow) var(--ease-standard);
`;

const Banner = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
  /* Shares --inset-pill with BannerPill: a message you read, not a control you press. */
  padding: var(--inset-pill);
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  align-items: center;
  text-align: center;
  max-width: 80%;
  pointer-events: auto;
  /* Above the dimmed children, below modals. */
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
