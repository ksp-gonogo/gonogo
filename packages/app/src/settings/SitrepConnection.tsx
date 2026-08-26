import type { DataSourceStatus } from "@ksp-gonogo/core";
import { getDataSource, useDataSources } from "@ksp-gonogo/core";
import {
  ConfigForm,
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
 * The single Gonogo/Sitrep connection row: reads status and config off
 * `sitrepStreamSource` (`packages/app/src/dataSources/sitrep.ts`) through the
 * generic `DataSource` interface. Its own file rather than inline in
 * `SettingsModal.tsx` so the Hub setup wizard's setup-assist step can reuse
 * the same host/data-source UI.
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
        <ConfigForm $boxed>
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
  gap: var(--space-8);
`;

export const Name = styled.span`
  flex: 1;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
`;

const Item = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
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
  border-radius: var(--radius-circle);
  flex-shrink: 0;
  background: ${({ $status }) => statusColor[$status]};
  animation: ${({ $status }) =>
    $status === "connected" || $status === "reconnecting" ? pulse : "none"}
    ${({ $status }) => ($status === "reconnecting" ? "1s" : "2s")}
    var(--ease-emphasis) infinite;
`;

const StatusLabel = styled.span<{ $status: DataSourceStatus }>`
  font-size: var(--font-size-xs);
  color: ${({ $status }) => statusColor[$status]};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const RetryButton = styled(GhostButton)`
  font-size: var(--font-size-xs);
  letter-spacing: 0.05em;
  white-space: nowrap;
  padding: var(--space-2) var(--space-6);
`;

const ConfigButton = styled(IconButton)<{ $active: boolean }>`
  color: ${({ $active }) =>
    $active ? "var(--color-text-primary)" : "var(--color-text-faint)"};
  font-size: var(--font-size-sm);
  padding: 0 var(--space-2);
`;

const SetupInstructions = styled.pre`
  margin: 0;
  padding: var(--space-8) var(--space-10);
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  white-space: pre-wrap;
  line-height: var(--line-height-prose);
`;
