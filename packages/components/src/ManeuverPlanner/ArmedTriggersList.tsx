import { ArrowRightIcon, CloseIcon } from "@gonogo/ui";
import styled from "styled-components";
import { PRESETS } from "./presets";
import type { ArmedTrigger } from "./triggerTypes";

interface ArmedTriggersListProps {
  triggers: readonly ArmedTrigger[];
  onCancel: (id: string) => void;
}

export function ArmedTriggersList({
  triggers,
  onCancel,
}: ArmedTriggersListProps) {
  if (triggers.length === 0) return null;
  return (
    <List>
      {triggers.map((t) => {
        const presetLabel =
          PRESETS.find((p) => p.id === t.inputs.preset)?.label ??
          t.inputs.preset;
        return (
          <ArmedRow key={t.id} role="status">
            <Main>
              <Primary>
                {t.dataKey} {t.op} {t.value}
              </Primary>
              <Meta>
                <ArrowRightIcon size={11} /> {presetLabel}
              </Meta>
            </Main>
            <CancelButton
              type="button"
              onClick={() => onCancel(t.id)}
              aria-label="Cancel armed trigger"
            >
              <CloseIcon size={12} />
            </CancelButton>
          </ArmedRow>
        );
      })}
    </List>
  );
}

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ArmedRow = styled.li`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-status-warning-bg);
  border-radius: 2px;
`;

const Main = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
`;

const Primary = styled.div`
  font-size: 13px;
  color: var(--color-status-warning-bg);
  font-weight: 600;
  letter-spacing: 0.02em;
`;

const Meta = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
  letter-spacing: 0.04em;
  display: inline-flex;
  align-items: center;
  gap: 3px;
`;

const CancelButton = styled.button`
  background: transparent;
  border: 1px solid var(--color-status-alert-muted);
  color: var(--color-text-muted);
  width: 22px;
  height: 22px;
  border-radius: 2px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  &:hover {
    background: var(--color-tag-dark-brown-bg);
    color: var(--color-tag-red-fg);
  }
`;
