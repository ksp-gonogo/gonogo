import type { ConfigField, DataSourceStatus } from "@ksp-gonogo/core";
import {
  compareVersions,
  getAppVersion,
  getDataSource,
  type MismatchKind,
  useDataSources,
} from "@ksp-gonogo/core";
import { Placeholder } from "@ksp-gonogo/ui";
import {
  BigReadout,
  Cluster,
  ConfigForm,
  FieldLabel,
  FieldRow,
  FormActions,
  GearIcon,
  GhostButton,
  IconButton,
  Input,
  Panel,
  PrimaryButton,
  ReadoutCaption,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import styled, { keyframes } from "styled-components";

interface RemoteVersionExposing {
  getRemoteVersion?: () => { version: string; buildTime: string } | null;
  onRemoteVersionChange?: (
    cb: (info: { version: string; buildTime: string } | null) => void,
  ) => () => void;
}

/**
 * Subscribes to a source's remote version (if it exposes one) and
 * compares against the locally-baked app version. Returns null when the
 * source doesn't expose a version channel, or when local + remote match.
 */
function useRemoteVersionMismatch(sourceId: string): {
  remote: { version: string; buildTime: string } | null;
  kind: MismatchKind;
} {
  const [remote, setRemote] = useState<{
    version: string;
    buildTime: string;
  } | null>(() => {
    const src = getDataSource(sourceId) as RemoteVersionExposing | undefined;
    return src?.getRemoteVersion?.() ?? null;
  });

  useEffect(() => {
    const src = getDataSource(sourceId) as RemoteVersionExposing | undefined;
    if (!src?.onRemoteVersionChange) return;
    setRemote(src.getRemoteVersion?.() ?? null);
    return src.onRemoteVersionChange(setRemote);
  }, [sourceId]);

  const local = getAppVersion()?.version;
  const kind: MismatchKind = local
    ? compareVersions(local, remote?.version)
    : "unknown";
  return { remote, kind };
}

function DataSourceStatusComponent({
  w,
  h,
}: Readonly<{ w?: number; h?: number }>) {
  const sources = useDataSources();
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const openConfig = (id: string) => {
    const source = getDataSource(id);
    if (!source) return;
    const current = source.getConfig();
    setFormValues(
      Object.fromEntries(
        Object.entries(current).map(([k, v]) => [k, String(v)]),
      ),
    );
    setConfiguringId(id);
  };

  const saveConfig = (id: string, schema: ConfigField[]) => {
    const source = getDataSource(id);
    if (!source) return;
    const parsed: Record<string, unknown> = {};
    for (const field of schema) {
      parsed[field.key] =
        field.type === "number"
          ? Number(formValues[field.key])
          : formValues[field.key];
    }
    source.configure(parsed);
    setConfiguringId(null);
  };

  // Selective rendering: at small sizes the per-source rows lose their
  // config buttons and retry chrome; tinier collapses to a healthy/total
  // count badge.
  const cols = w ?? 12;
  const rows = h ?? 10;
  const showFullRows = rows >= 6 && cols >= 6;
  const showCompactRows = !showFullRows && rows >= 4 && cols >= 3;

  if (!showFullRows && !showCompactRows) {
    const total = sources.length;
    const ok = sources.filter((s) => s.status === "connected").length;
    return (
      <Panel panelTitle="SOURCES">
        <BigReadout $tone={ok === total && total > 0 ? "go" : "alert"}>
          {`${ok} / ${total}`}
          <ReadoutCaption>connected</ReadoutCaption>
        </BigReadout>
      </Panel>
    );
  }

  if (showCompactRows) {
    return (
      <Panel panelTitle="Sources">
        {sources.length === 0 ? (
          <Placeholder>No data sources registered</Placeholder>
        ) : (
          <CompactList>
            {sources.map((s) => (
              <CompactRow key={s.id}>
                <Indicator $status={s.status} />
                <Name>{s.name}</Name>
              </CompactRow>
            ))}
          </CompactList>
        )}
      </Panel>
    );
  }

  return (
    <Panel panelTitle="Data Sources">
      {sources.length === 0 ? (
        <Placeholder>No data sources registered</Placeholder>
      ) : (
        <List>
          {sources.map((source) => {
            const schema = getDataSource(source.id)?.configSchema() ?? [];
            const isConfiguring = configuringId === source.id;
            return (
              <Item key={source.id}>
                <Cluster justify="start">
                  <Indicator $status={source.status} />
                  <Name>{source.name}</Name>
                  <RemoteVersionPill sourceId={source.id} />
                  <StatusLabel $status={source.status}>
                    {source.status}
                  </StatusLabel>
                  {source.status === "disconnected" && (
                    <RetryButton
                      onClick={() => {
                        void getDataSource(source.id)?.connect();
                      }}
                      aria-label={`Reconnect ${source.name}`}
                    >
                      Reconnect
                    </RetryButton>
                  )}
                  {schema.length > 0 && (
                    <ConfigButton
                      onClick={() =>
                        isConfiguring
                          ? setConfiguringId(null)
                          : openConfig(source.id)
                      }
                      aria-label={`Configure ${source.name}`}
                      $active={isConfiguring}
                    >
                      <GearIcon size={14} />
                    </ConfigButton>
                  )}
                </Cluster>
                {source.status === "disconnected" &&
                  (() => {
                    const instructions = getDataSource(
                      source.id,
                    )?.setupInstructions?.();
                    return instructions ? (
                      <SetupInstructions>{instructions}</SetupInstructions>
                    ) : null;
                  })()}
                {isConfiguring && (
                  <ConfigForm $boxed>
                    {schema.map((field) => {
                      const inputId = `config-${source.id}-${field.key}`;
                      return (
                        <FieldRow key={field.key}>
                          <FieldLabel htmlFor={inputId}>
                            {field.label}
                          </FieldLabel>
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
                      <PrimaryButton
                        onClick={() => saveConfig(source.id, schema)}
                      >
                        Save
                      </PrimaryButton>
                      <GhostButton onClick={() => setConfiguringId(null)}>
                        Cancel
                      </GhostButton>
                    </FormActions>
                  </ConfigForm>
                )}
              </Item>
            );
          })}
        </List>
      )}
    </Panel>
  );
}

export { DataSourceStatusComponent };

function RemoteVersionPill({ sourceId }: { sourceId: string }) {
  const { remote, kind } = useRemoteVersionMismatch(sourceId);
  if (!remote) return null;
  if (kind === "same" || kind === "patch") {
    return (
      <VersionTag
        $kind="same"
        title={`v${remote.version}${remote.buildTime ? ` (build ${remote.buildTime})` : ""}`}
      >
        v{remote.version}
      </VersionTag>
    );
  }
  return (
    <VersionTag
      $kind={kind}
      title={`Local ↔ remote: ${kind} mismatch (remote v${remote.version})`}
    >
      v{remote.version}
    </VersionTag>
  );
}

// --- Styles ---

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
`;

const Item = styled.li`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
`;

const CompactList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const CompactRow = styled.li`
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-4) 0;
`;

const Name = styled.span`
  flex: 1;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
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
  /* Indefinite animation, so it needs its own guard: the global damper in
     global.css only clamps duration under prefers-reduced-motion: reduce,
     it does not stop a looping pulse. The 1s / 2s period stays literal
     because it is not a UI-motion choice, it is how the operator reads
     connection state (reconnecting pulses twice as fast as connected). */
  @media (prefers-reduced-motion: no-preference) {
    animation: ${({ $status }) =>
      $status === "connected" || $status === "reconnecting" ? pulse : "none"}
      ${({ $status }) => ($status === "reconnecting" ? "1s" : "2s")}
      var(--ease-emphasis) infinite;
  }
`;

const StatusLabel = styled.span<{ $status: DataSourceStatus }>`
  font-size: var(--font-size-xs);
  color: ${({ $status }) => statusColor[$status]};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const ConfigButton = styled(IconButton)<{ $active: boolean }>`
  color: ${({ $active }) => ($active ? "var(--color-text-primary)" : "var(--color-text-faint)")};
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

const RetryButton = styled(GhostButton)`
  font-size: var(--font-size-xs);
  letter-spacing: 0.05em;
  white-space: nowrap;
  padding: var(--space-2) var(--space-6);
`;

const VERSION_TAG_COLOR: Record<
  "same" | "minor" | "major" | "unknown",
  string
> = {
  same: "var(--color-text-dim)",
  minor: "var(--color-status-warning-bg)",
  major: "var(--color-status-nogo-bg)",
  unknown: "var(--color-text-muted)",
};

const VersionTag = styled.span<{
  $kind: "same" | "minor" | "major" | "unknown";
}>`
  font-size: var(--font-size-xs);
  letter-spacing: 0.05em;
  padding: var(--space-hair) var(--space-6);
  border-radius: var(--radius-pill);
  border: 1px solid ${({ $kind }) => VERSION_TAG_COLOR[$kind]};
  color: ${({ $kind }) => VERSION_TAG_COLOR[$kind]};
  background: rgba(0, 0, 0, 0.2);
  white-space: nowrap;
`;
