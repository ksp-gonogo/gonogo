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
  Badge,
  type BadgeTone,
  BigReadout,
  Box,
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
  Stack,
  StatusIndicator,
  type StatusTone,
  Truncate,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";

/** Full-row source-name label: the font-size/colour worn over `Truncate`'s
 *  flex/ellipsis behaviour. */
const SOURCE_NAME_STYLE = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-primary)",
} as const;

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
          <Stack as="ul" gap="sm" style={LIST_STYLE}>
            {sources.map((s) => (
              <li key={s.id}>
                <StatusIndicator
                  tone={statusTone(s.status)}
                  pulse={statusPulse(s.status)}
                >
                  {s.name}
                </StatusIndicator>
              </li>
            ))}
          </Stack>
        )}
      </Panel>
    );
  }

  return (
    <Panel panelTitle="Data Sources">
      {sources.length === 0 ? (
        <Placeholder>No data sources registered</Placeholder>
      ) : (
        <Stack as="ul" gap="md" style={LIST_STYLE}>
          {sources.map((source) => {
            const schema = getDataSource(source.id)?.configSchema() ?? [];
            const isConfiguring = configuringId === source.id;
            return (
              <Stack as="li" gap="sm" key={source.id}>
                <Cluster justify="start">
                  <Truncate style={SOURCE_NAME_STYLE}>{source.name}</Truncate>
                  <RemoteVersionPill sourceId={source.id} />
                  <StatusIndicator
                    tone={statusTone(source.status)}
                    pulse={statusPulse(source.status)}
                  >
                    {source.status}
                  </StatusIndicator>
                  {source.status === "disconnected" && (
                    <GhostButton
                      onClick={() => {
                        void getDataSource(source.id)?.connect();
                      }}
                      aria-label={`Reconnect ${source.name}`}
                      style={RETRY_BUTTON_STYLE}
                    >
                      Reconnect
                    </GhostButton>
                  )}
                  {schema.length > 0 && (
                    <IconButton
                      onClick={() =>
                        isConfiguring
                          ? setConfiguringId(null)
                          : openConfig(source.id)
                      }
                      aria-label={`Configure ${source.name}`}
                      style={{
                        color: isConfiguring
                          ? "var(--color-text-primary)"
                          : "var(--color-text-faint)",
                        fontSize: "var(--font-size-sm)",
                        padding: "0 var(--space-2)",
                      }}
                    >
                      <GearIcon size={14} />
                    </IconButton>
                  )}
                </Cluster>
                {source.status === "disconnected" &&
                  (() => {
                    const instructions = getDataSource(
                      source.id,
                    )?.setupInstructions?.();
                    return instructions ? (
                      <Box
                        surface="sunken"
                        bordered
                        radius="sm"
                        style={SETUP_INSTRUCTIONS_STYLE}
                      >
                        {instructions}
                      </Box>
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
              </Stack>
            );
          })}
        </Stack>
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
      <Badge
        tone="neutral"
        size="sm"
        title={`v${remote.version}${remote.buildTime ? ` (build ${remote.buildTime})` : ""}`}
      >
        v{remote.version}
      </Badge>
    );
  }
  return (
    <Badge
      tone={VERSION_BADGE_TONE[kind]}
      size="sm"
      title={`Local ↔ remote: ${kind} mismatch (remote v${remote.version})`}
    >
      v{remote.version}
    </Badge>
  );
}

// Resets the semantic `<ul>`'s own bullet/margin/padding; `Stack` supplies
// the flex-column + gap.
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;

const STATUS_TONE: Record<DataSourceStatus, StatusTone> = {
  connected: "go",
  disconnected: "neutral",
  reconnecting: "warn",
  error: "nogo",
};

function statusTone(status: DataSourceStatus): StatusTone {
  return STATUS_TONE[status];
}

/**
 * Live connection state pulses the dot (parity with the original): a steady
 * `connected` link breathes slowly, a `reconnecting` one pulses twice as fast.
 * Settled states (disconnected / error) hold still.
 */
function statusPulse(status: DataSourceStatus): "slow" | "fast" | undefined {
  if (status === "connected") return "slow";
  if (status === "reconnecting") return "fast";
  return undefined;
}

const RETRY_BUTTON_STYLE = {
  fontSize: "var(--font-size-xs)",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
  padding: "var(--space-2) var(--space-6)",
} as const;

const SETUP_INSTRUCTIONS_STYLE = {
  padding: "var(--space-8) var(--space-10)",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-faint)",
  whiteSpace: "pre-wrap",
  lineHeight: "var(--line-height-prose)",
} as const;

const VERSION_BADGE_TONE: Record<"minor" | "major" | "unknown", BadgeTone> = {
  minor: "warn",
  major: "nogo",
  unknown: "neutral",
};
