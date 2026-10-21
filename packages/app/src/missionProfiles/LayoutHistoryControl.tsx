import styled from "styled-components";
import {
  useMissionProfiles,
  useMissionProfilesService,
} from "./MissionProfilesContext";
import type { ProfileDashboard } from "./ProfileDashboard";
import { useHistoryState } from "./useProfileDashboard";

interface LayoutHistoryControlProps {
  dashboard: ProfileDashboard;
}

/**
 * Undo and Redo for the dashboard, beside the name of the layout it is
 * saving into. Steps back through widget changes and layout switches. Shown
 * once there is something to step through.
 */
export function LayoutHistoryControl({
  dashboard,
}: Readonly<LayoutHistoryControlProps>) {
  const svc = useMissionProfilesService();
  const profiles = useMissionProfiles();
  const { canUndo, canRedo } = useHistoryState(dashboard);
  if (!canUndo && !canRedo) return null;
  const name = profiles.find((p) => p.id === svc.getCurrentId())?.name;

  return (
    <Wrap role="group" aria-label="Layout history">
      {name ? <Name>{name}</Name> : null}
      <HistoryButton
        type="button"
        disabled={!canUndo}
        onClick={() => dashboard.undo()}
      >
        Undo
      </HistoryButton>
      <HistoryButton
        type="button"
        disabled={!canRedo}
        onClick={() => dashboard.redo()}
      >
        Redo
      </HistoryButton>
    </Wrap>
  );
}

const Wrap = styled.div`
  height: 40px;
  display: inline-flex;
  align-items: stretch;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-pill);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  font-family: inherit;

  @media (pointer: coarse) {
    height: 48px;
  }
`;

const Name = styled.span`
  display: inline-flex;
  align-items: center;
  padding: var(--inset-prompt-button);
  color: var(--color-text-muted);
  font-size: var(--font-size-compact);
  white-space: nowrap;
`;

const HistoryButton = styled.button`
  appearance: none;
  border: 0;
  border-left: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-compact);
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: var(--inset-prompt-button);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--color-border-subtle);
  }

  &:disabled {
    color: var(--color-text-faint);
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid var(--color-info-mark);
    outline-offset: -2px;
  }
`;
