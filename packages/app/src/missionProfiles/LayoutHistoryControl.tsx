import { IconButton, RecallIcon, Tooltip } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import {
  useMissionProfiles,
  useMissionProfilesService,
} from "./MissionProfilesContext";
import type { HistoryStep, ProfileDashboard } from "./ProfileDashboard";
import { useHistoryState } from "./useProfileDashboard";

interface LayoutHistoryControlProps {
  dashboard: ProfileDashboard;
}

const STEP_WORDS: Record<HistoryStep, string> = {
  change: "layout change",
  switch: "layout switch",
};

function stepLabel(verb: string, step: HistoryStep | null): string {
  return step ? `${verb} ${STEP_WORDS[step]}` : verb;
}

/**
 * The name of the layout the dashboard is saving into, with Undo and Redo
 * beside it, as actions in the screen header. Both step through widget
 * changes and layout switches and stay disabled while there is nothing to
 * step through.
 */
export function LayoutHistoryControl({
  dashboard,
}: Readonly<LayoutHistoryControlProps>) {
  const svc = useMissionProfilesService();
  const profiles = useMissionProfiles();
  const { canUndo, canRedo, undoStep, redoStep } = useHistoryState(dashboard);
  const name = profiles.find((p) => p.id === svc.getCurrentId())?.name;

  return (
    <Wrap role="group" aria-label="Layout history">
      {name ? (
        <Tooltip text={name} focusable>
          <Name>{name}</Name>
        </Tooltip>
      ) : null}
      <Tooltip text={`${stepLabel("Undo", undoStep)} (Ctrl/Cmd+Z)`}>
        <HistoryButton
          type="button"
          aria-label={stepLabel("Undo", undoStep)}
          aria-keyshortcuts="Control+Z Meta+Z"
          disabled={!canUndo}
          onClick={() => dashboard.undo()}
        >
          <RecallIcon />
        </HistoryButton>
      </Tooltip>
      <Tooltip text={`${stepLabel("Redo", redoStep)} (Ctrl/Cmd+Shift+Z)`}>
        <HistoryButton
          type="button"
          aria-label={stepLabel("Redo", redoStep)}
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
          disabled={!canRedo}
          onClick={() => dashboard.redo()}
        >
          <Mirrored>
            <RecallIcon />
          </Mirrored>
        </HistoryButton>
      </Tooltip>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: inline-flex;
  align-items: center;
  gap: var(--gap-related);
  min-width: 0;
`;

const Name = styled.span`
  max-width: 20ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);
  font-size: var(--font-size-value);
`;

/** Redo is the undo arrow turned the other way round. */
const Mirrored = styled.span`
  display: inline-flex;
  transform: scaleX(-1);
`;

const HistoryButton = styled(IconButton)`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-primary);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);

  @media (hover: hover) {
    &:hover:not(:disabled) {
      background: var(--color-border-subtle);
    }
  }
`;
