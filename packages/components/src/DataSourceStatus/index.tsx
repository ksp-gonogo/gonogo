import type { ConfigField, DataSourceStatus } from "@gonogo/core";
import {
  compareVersions,
  getAppVersion,
  getDataSource,
  getStreamSource,
  type MismatchKind,
  registerComponent,
  useDataSources,
  useStreamSources,
} from "@gonogo/core";
import {
  FieldLabel,
  FieldRow,
  FormActions,
  GhostButton,
  IconButton,
  Input,
  PanelScrollable,
  PanelTitle,
  Placeholder,
  PrimaryButton,
} from "@gonogo/ui";
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

function useRemoteStreamVersionMismatch(sourceId: string): {
  remote: { version: string; buildTime: string } | null;
  kind: MismatchKind;
} {
  const [remote, setRemote] = useState<{
    version: string;
    buildTime: string;
  } | null>(() => {
    const src = getStreamSource(sourceId) as RemoteVersionExposing | undefined;
    return src?.getRemoteVersion?.() ?? null;
  });

  useEffect(() => {
    const src = getStreamSource(sourceId) as RemoteVersionExposing | undefined;
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

function DataSourceStatusComponent() {
  const sources = useDataSources();
  const streamSources = useStreamSources();
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

  return (
    <PanelScrollable>
      <PanelTitle>Data Sources</PanelTitle>
      {sources.length === 0 ? (
        <Placeholder>No data sources registered</Placeholder>
      ) : (
        <List>
          {sources.map((source) => {
            const schema = getDataSource(source.id)?.configSchema() ?? [];
            const isConfiguring = configuringId === source.id;
            return (
              <Item key={source.id}>
                <Row>
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
                      ⚙
                    </ConfigButton>
                  )}
                </Row>
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
                  <ConfigForm>
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

      {streamSources.length > 0 && (
        <>
          <PanelTitle>Stream Sources</PanelTitle>
          <List>
            {streamSources.map((s) => (
              <Item key={s.id}>
                <Row>
                  <Indicator $status={s.status} />
                  <Name>{s.name}</Name>
                  <RemoteStreamVersionPill sourceId={s.id} />
                  <StreamCount>
                    {s.streamCount} stream{s.streamCount === 1 ? "" : "s"}
                  </StreamCount>
                  <StatusLabel $status={s.status}>{s.status}</StatusLabel>
                  {s.status === "disconnected" && (
                    <RetryButton
                      onClick={() => {
                        void getStreamSource(s.id)?.connect();
                      }}
                      aria-label={`Reconnect ${s.name}`}
                    >
                      Reconnect
                    </RetryButton>
                  )}
                </Row>
              </Item>
            ))}
          </List>
        </>
      )}
    </PanelScrollable>
  );
}

registerComponent({
  id: "data-source-status",
  name: "Data Source Status",
  description:
    "Shows connection status for all registered data sources and lets you edit their configuration.",
  tags: ["system"],
  defaultSize: { w: 12, h: 10 },
  component: DataSourceStatusComponent,
  dataRequirements: [],
  defaultConfig: {},
});

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

function RemoteStreamVersionPill({ sourceId }: { sourceId: string }) {
  const { remote, kind } = useRemoteStreamVersionMismatch(sourceId);
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
  gap: 8px;
`;

const Item = styled.li`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Name = styled.span`
  flex: 1;
  font-size: 13px;
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

const StreamCount = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
  letter-spacing: 0.05em;
`;

const ConfigButton = styled(IconButton)<{ $active: boolean }>`
  color: ${({ $active }) => ($active ? "var(--color-text-primary)" : "var(--color-text-faint)")};
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

const RetryButton = styled(GhostButton)`
  font-size: var(--font-size-xs);
  letter-spacing: 0.05em;
  white-space: nowrap;
  padding: 2px 6px;
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
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid ${({ $kind }) => VERSION_TAG_COLOR[$kind]};
  color: ${({ $kind }) => VERSION_TAG_COLOR[$kind]};
  background: rgba(0, 0, 0, 0.2);
  white-space: nowrap;
`;
