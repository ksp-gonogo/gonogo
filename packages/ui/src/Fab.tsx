import type { ButtonHTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { useFabCluster } from "./FabCluster";

interface FabProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Distance from the bottom of the viewport in px. Use to stack FABs. */
  bottom: number;
  children: ReactNode;
}

/** Secondary floating action button, hidden until its FabCluster is active; its visible label comes from `aria-label` or `title`. */
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

/** The button is the row's tallest item, so the label beside it never moves the button. */
const FabRow = styled.div<{ $visible: boolean; $bottom: number }>`
  position: fixed;
  bottom: calc(${({ $bottom }) => $bottom}px + env(safe-area-inset-bottom, 0px));
  /* Off the spacing ladder: the FAB geometry chain in FabPrompt and BannerStack is arithmetic on this 24px. */
  right: calc(24px + env(safe-area-inset-right, 0px));
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  gap: var(--gap-pill);
  z-index: var(--z-fab);
  pointer-events: ${({ $visible }) => ($visible ? "auto" : "none")};
`;

const FabLabel = styled.span<{ $visible: boolean }>`
  pointer-events: none;
  white-space: nowrap;
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-floating);
  padding: var(--inset-surface);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-compact);
  line-height: var(--line-height-tight);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transform: translateY(${({ $visible }) => ($visible ? "0" : "16px")});
  /* Off the duration scale: tuned against the 16px travel and FabCluster's 400ms leave delay. */
  transition:
    transform 0.18s var(--ease-standard),
    opacity 0.18s var(--ease-standard);
`;

const StyledFab = styled.button<{ $visible: boolean }>`
  width: 40px;
  height: 40px;
  border-radius: var(--radius-circle);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  color: var(--color-info-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  flex: none;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  pointer-events: ${({ $visible }) => ($visible ? "auto" : "none")};
  transform: translateY(${({ $visible }) => ($visible ? "0" : "16px")});
  /* The same 0.18s as FabLabel. */
  transition:
    background var(--duration-base),
    transform 0.18s var(--ease-standard),
    opacity 0.18s var(--ease-standard),
    border-color var(--duration-base);

  @media (hover: hover) {
    &:hover {
      background: var(--color-border-subtle);
      border-color: var(--color-info-mark);
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
