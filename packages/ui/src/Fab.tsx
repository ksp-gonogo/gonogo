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
 *
 * When the cluster is active a persistent text label (Material Speed Dial
 * `tooltipOpen` style) slides in to the LEFT of the round button. The label
 * text is derived from `aria-label` (falling back to `title`) and is marked
 * `aria-hidden` since the button already carries the accessible name.
 */
export function Fab({ bottom, children, ...rest }: Readonly<FabProps>) {
  const cluster = useFabCluster();
  const visible = cluster?.active ?? true;
  const label =
    (rest["aria-label"] as string | undefined) ??
    (rest.title as string | undefined);

  return (
    <FabRow
      $visible={visible}
      $bottom={bottom}
      onMouseEnter={cluster?.onMouseEnter}
      onMouseLeave={cluster?.onMouseLeave}
      onFocus={cluster?.onFocus}
      onBlur={cluster?.onBlur}
    >
      {label ? (
        <FabLabel $visible={visible} aria-hidden="true">
          {label}
        </FabLabel>
      ) : null}
      <StyledFab $visible={visible} tabIndex={visible ? 0 : -1} {...rest}>
        {children}
      </StyledFab>
    </FabRow>
  );
}

/**
 * Fixed-position row anchored to the same bottom/right as the old standalone
 * button. The round button keeps its exact on-screen position and size: it is
 * the tallest item, so `align-items: center` + `bottom`-anchoring places its
 * bottom edge at `$bottom` and its right edge at `right: 24px`, identical to
 * before. The label sits to its left and never affects the button's position.
 */
const FabRow = styled.div<{ $visible: boolean; $bottom: number }>`
  position: fixed;
  bottom: calc(${({ $bottom }) => $bottom}px + env(safe-area-inset-bottom, 0px));
  right: calc(24px + env(safe-area-inset-right, 0px));
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  z-index: 900;
  pointer-events: ${({ $visible }) => ($visible ? "auto" : "none")};
`;

const FabLabel = styled.span<{ $visible: boolean }>`
  pointer-events: none;
  white-space: nowrap;
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-strong);
  border-radius: 6px;
  padding: 4px 8px;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
  line-height: 1.2;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transform: translateY(${({ $visible }) => ($visible ? "0" : "16px")});
  transition:
    transform 0.18s ease,
    opacity 0.18s ease;
`;

const StyledFab = styled.button<{ $visible: boolean }>`
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
  flex: none;
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
