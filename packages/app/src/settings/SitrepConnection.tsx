import type { DataSourceStatus } from "@ksp-gonogo/core";
import { getDataSource, useDataSources } from "@ksp-gonogo/core";
import {
  FieldLabel,
  FieldRow,
  FormActions,
  GearIcon,
  GhostButton,
  IconButton,
  Input,
  Placeholder,
  PrimaryButton,
} from "@ksp-gonogo/ui";
import { useState } from "react";
import styled, { keyframes } from "styled-components";

/**
 * The single Gonogo/Sitrep connection row — reuses `sitrepStreamSource`
 * (`packages/app/src/dataSources/sitrep.ts`) for status/config exactly the
 * way the old `DataSourceStatusComponent` did for every source, narrowed to
 * just this one. Lifted out of `SettingsModal.tsx` so the Hub setup
 * wizard's setup-assist step can reuse the same host/data-source UI.
 */
export function SitrepConnection() {
  const dataSources = useDataSources();
  const source = dataSources.find((s) => s.id === "sitrep");
  const [editingConfig, setEditingConfig] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  if (!source) {
    return <Placeholder>Telemetry stream not registered</Placeholder>;
  }

  const schema = getDataSource("sitrep")?.configSchema() ?? [];

  const openConfig = () => {
    const current = getDataSource("sitrep")?.getConfig() ?? {};
    setFormValues(
      Object.fromEntries(
        Object.entries(current).map(([k, v]) => [k, String(v)]),
      ),
    );
    setEditingConfig(true);
  };

  const saveConfig = () => {
    const parsed: Record<string, unknown> = {};
    for (const field of schema) {
      parsed[field.key] =
        field.type === "number"
          ? Number(formValues[field.key])
          : formValues[field.key];
    }
    getDataSource("sitrep")?.configure(parsed);
    setEditingConfig(false);
  };

  const instructions =
    source.status === "disconnected"
      ? getDataSource("sitrep")?.setupInstructions?.()
      : undefined;

  return (
    <Item>
      <ConnectionRow>
        <Indicator $status={source.status} />
        <Name>{source.name}</Name>
        <StatusLabel $status={source.status}>{source.status}</StatusLabel>
        {source.status === "disconnected" && (
          <RetryButton
            onClick={() => {
              void getDataSource("sitrep")?.connect();
            }}
            aria-label={`Reconnect ${source.name}`}
          >
            Reconnect
          </RetryButton>
        )}
        {schema.length > 0 && (
          <ConfigButton
            onClick={() =>
              editingConfig ? setEditingConfig(false) : openConfig()
            }
            aria-label={`Configure ${source.name}`}
            $active={editingConfig}
          >
            <GearIcon size={14} />
          </ConfigButton>
        )}
      </ConnectionRow>
      {instructions && <SetupInstructions>{instructions}</SetupInstructions>}
      {editingConfig && (
        <ConfigForm>
          {schema.map((field) => {
            const inputId = `config-sitrep-${field.key}`;
            return (
              <FieldRow key={field.key}>
                <FieldLabel htmlFor={inputId}>{field.label}</FieldLabel>
                <Input
                  id={inputId}
                  type={field.type === "number" ? "number" : "text"}
                  placeholder={field.placeholder}
                  value={formValues[field.key] ?? ""}
                  onChange={(e) =>
                    setFormValues((prev) => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))
                  }
                />
              </FieldRow>
            );
          })}
          <FormActions>
            <PrimaryButton onClick={saveConfig}>Save</PrimaryButton>
            <GhostButton onClick={() => setEditingConfig(false)}>
              Cancel
            </GhostButton>
          </FormActions>
        </ConfigForm>
      )}
    </Item>
  );
}

// --- shared row styling, also used by SettingsModal's Uplink lists ---

export const ConnectionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const Name = styled.span`
  flex: 1;
  font-size: 13px;
  color: var(--color-text-primary);
`;

const Item = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const statusColor: Record<DataSourceStatus, string> = {
  connected: "var(--color-accent-fg)",
  disconnected: "var(--color-text-faint)",
  reconnecting: "var(--color-status-warning-bg)",
  error: "var(--color-status-nogo-bg)",
};

const Indicator = styled.span<{ $status: DataSourceStatus }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${({ $status }) => statusColor[$status]};
  animation: ${({ $status }) =>
    $status === "connected" || $status === "reconnecting" ? pulse : "none"}
    ${({ $status }) => ($status === "reconnecting" ? "1s" : "2s")} ease-in-out
    infinite;
`;

const StatusLabel = styled.span<{ $status: DataSourceStatus }>`
  font-size: 11px;
  color: ${({ $status }) => statusColor[$status]};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const RetryButton = styled(GhostButton)`
  font-size: var(--font-size-xs);
  letter-spacing: 0.05em;
  white-space: nowrap;
  padding: 2px 6px;
`;

const ConfigButton = styled(IconButton)<{ $active: boolean }>`
  color: ${({ $active }) =>
    $active ? "var(--color-text-primary)" : "var(--color-text-faint)"};
  font-size: 13px;
  padding: 0 2px;
`;

const ConfigForm = styled.div`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const SetupInstructions = styled.pre`
  margin: 0;
  padding: 8px 10px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  font-size: 11px;
  color: var(--color-text-faint);
  white-space: pre-wrap;
  line-height: 1.5;
`;
