import type { ReactNode } from "react";
import styled from "styled-components";

export interface BannerStackProps {
  children: ReactNode;
}

/** Fixed strip left of the action FAB, at its height (above it, as a column, below 640px), holding every ephemeral status banner; the first child sits nearest the FAB and overflow scrolls. */
export function BannerStack({ children }: BannerStackProps) {
  return <ToastStack>{children}</ToastStack>;
}

const ToastStack = styled.div`
  position: fixed;
  /* Off the spacing ladder: these are arithmetic on the FAB geometry (88 = 24 + 48 + 16, 112 = 88 + 24) and move only with it. */
  right: calc(88px + env(safe-area-inset-right, 0px));
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  /* Below the modal layer: an interactive pill above a dialog would sit outside its focus trap. */
  z-index: 90;
  display: flex;
  flex-direction: row-reverse;
  align-items: center;
  gap: var(--gap-related);
  height: 48px;
  max-width: calc(100vw - 112px - env(safe-area-inset-right, 0px));
  overflow-x: auto;
  overflow-y: hidden;
  pointer-events: none;

  /* The strip passes clicks through; each banner fills its height and does not shrink. */
  > * {
    pointer-events: auto;
    flex-shrink: 0;
    height: 100%;
    display: inline-flex;
    align-items: center;
  }

  /* On a phone the strip beside the FAB is too short for even one pill, so the banners stack in a column above it, newest nearest the FAB, and long text wraps. */
  @media (max-width: 640px) {
    right: calc(16px + env(safe-area-inset-right, 0px));
    bottom: calc(88px + env(safe-area-inset-bottom, 0px));
    flex-direction: column-reverse;
    align-items: flex-end;
    height: auto;
    max-width: calc(100vw - 32px - env(safe-area-inset-right, 0px));
    max-height: 40vh;
    overflow: visible;

    && > * {
      height: auto;
      max-width: 100%;
      white-space: normal;
    }
  }

  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  &:hover {
    scrollbar-color: var(--color-border-strong) transparent;
  }
`;
