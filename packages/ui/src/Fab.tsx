import type { ButtonHTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { useFabCluster } from "./FabCluster";

interface FabProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Distance from the bottom of the viewport in px. Use to stack FABs. */
  bottom: number;
  children: ReactNode;
}

/**
 * Secondary floating action button. Collapses into invisibility when no
 * FabClusterProvider is active, so the host + and existing FABs appear
 * as a single hoverable cluster. Used for the flight-history, serial,
 * and station-link buttons.
 */
export function Fab({ bottom, children, ...rest }: Readonly<FabProps>) {
  const cluster = useFabCluster();
  const visible = cluster?.active ?? true;

  return (
    <StyledFab
      $visible={visible}
      $bottom={bottom}
      onMouseEnter={cluster?.onMouseEnter}
      onMouseLeave={cluster?.onMouseLeave}
      onFocus={cluster?.onFocus}
      onBlur={cluster?.onBlur}
      tabIndex={visible ? 0 : -1}
      {...rest}
    >
      {children}
    </StyledFab>
  );
}

const StyledFab = styled.button<{ $visible: boolean; $bottom: number }>`
  position: fixed;
  bottom: calc(${({ $bottom }) => $bottom}px + env(safe-area-inset-bottom, 0px));
  right: calc(24px + env(safe-area-inset-right, 0px));
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  color: var(--color-status-info-fg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  z-index: 900;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  pointer-events: ${({ $visible }) => ($visible ? "auto" : "none")};
  transform: translateY(${({ $visible }) => ($visible ? "0" : "16px")});
  transition:
    background 0.15s,
    transform 0.18s ease,
    opacity 0.18s ease,
    border-color 0.15s;

  @media (hover: hover) {
    &:hover {
      background: var(--color-border-subtle);
      border-color: var(--color-status-info-fg);
      transform: scale(1.05);
    }
  }

  &:active {
    transform: scale(0.97);
  }

  @media (pointer: coarse) {
    width: 48px;
    height: 48px;
  }
`;
