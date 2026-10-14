import styled from "styled-components";
import { useFabCluster } from "./FabCluster";

/**
 * The primary button of a FabCluster: a three-dot control that opens the
 * cluster's buttons on click, Enter or Space and closes it the same way.
 * Hover and focus still reveal the cluster, so the toggle is the way to keep it
 * open without holding the pointer over it. Renders nothing outside a
 * FabClusterProvider, where every button is already visible.
 */
export function FabClusterToggle() {
  const cluster = useFabCluster();
  if (!cluster) return null;

  return (
    <Toggle
      type="button"
      ref={cluster.toggleRef}
      aria-label="Dashboard controls"
      aria-expanded={cluster.expanded}
      aria-controls={cluster.regionId}
      onClick={cluster.toggle}
      onMouseEnter={cluster.onMouseEnter}
      onMouseLeave={cluster.onMouseLeave}
      onFocus={cluster.onFocus}
      onBlur={cluster.onBlur}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <circle cx="5" cy="12" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="19" cy="12" r="2" />
      </svg>
    </Toggle>
  );
}

const Toggle = styled.button`
  position: fixed;
  /* Held literal with the rest of the FAB-geometry chain: BannerStack's
     right: 88px (24 + 48 + 16), FabPrompt's 72px and Fab's own right: 24px are
     all arithmetic on this 48px button at 24px from the corner. */
  bottom: 24px;
  right: 24px;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-circle);
  background: var(--color-accent-fg);
  border: none;
  color: var(--color-text-inverse);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0, 204, 102, 0.3);
  z-index: var(--z-fab);
  transition:
    background var(--duration-base),
    transform var(--duration-fast);

  &:hover {
    background: var(--color-accent-bg);
    transform: scale(1.05);
  }
  &:active {
    transform: scale(0.97);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;
