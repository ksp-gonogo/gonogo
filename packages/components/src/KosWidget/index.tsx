import type { ComponentProps } from "@gonogo/core";
import { formatAge, registerComponent } from "@gonogo/core";
import { useKosWidget } from "@gonogo/data";
import { ScrollArea } from "@gonogo/ui";
import { useState } from "react";
import styled from "styled-components";
import { KosWidgetConfigComponent } from "./KosWidgetConfig";
import type { KosWidgetConfig } from "./types";

function formatValue(v: unknown): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    // Tidy up long fractionals; leave integers alone.
    return Number.isInteger(v) ? String(v) : v.toFixed(3);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function KosWidgetComponent({
  config,
}: Readonly<ComponentProps<KosWidgetConfig>>) {
  const {
    data,
    error,
    running,
    lastGoodAt,
    dispatch,
    disabled,
    disabledReason,
    reEnable,
  } = useKosWidget({
    cpu: config?.cpu ?? "",
    script: config?.script ?? "",
    args: config?.args ?? [],
    mode: config?.mode ?? "command",
    intervalMs: config?.intervalMs,
  });
  const [errorOpen, setErrorOpen] = useState(false);

  const notConfigured = !config?.cpu || !config?.script;
  const title = config?.title ?? config?.script ?? "kOS Widget";
  const ageMs = lastGoodAt ? Date.now() - lastGoodAt : null;
  // Paused supersedes the regular error banner — same rationale as
  // KosScriptFrame: showing both at once is just noise.
  const showError = !disabled && error;

  return (
    <Panel>
      <Header>
        <Title>{title}</Title>
        <HeaderActions>
          {running && <Spinner aria-label="running">…</Spinner>}
          {config?.mode !== "interval" && (
            <RunButton
              type="button"
              onClick={dispatch}
              disabled={running || notConfigured}
            >
              Run
            </RunButton>
          )}
        </HeaderActions>
      </Header>
      {disabled && (
        <PausedBanner role="status" aria-live="polite">
          <PausedText>
            <PausedLabel>Paused — kOS errors</PausedLabel>
            {disabledReason && <PausedReason>{disabledReason}</PausedReason>}
          </PausedText>
          <ReEnableButton type="button" onClick={reEnable}>
            Re-enable
          </ReEnableButton>
        </PausedBanner>
      )}
      {showError && (
        <ErrorBanner
          type="button"
          onClick={() => setErrorOpen((o) => !o)}
          aria-label="Show last error"
        >
          <ErrorLabel>Last call failed</ErrorLabel>
          {ageMs !== null && (
            <ErrorMeta>good data {formatAge(ageMs)} ago</ErrorMeta>
          )}
        </ErrorBanner>
      )}
      {errorOpen && showError && <ErrorDetail>{error.message}</ErrorDetail>}
      {renderBody()}
    </Panel>
  );

  function renderBody() {
    if (notConfigured) {
      return (
        <Empty>
          Configure the CPU tagname and script name in the widget settings.
        </Empty>
      );
    }
    if (!data) {
      return <Empty>{running ? "Running…" : "No data yet. Press Run."}</Empty>;
    }
    return (
      <DataGrid>
        {Object.entries(data).map(([k, v]) => (
          <DataRow key={k}>
            <Key>{k}</Key>
            <Value>{formatValue(v)}</Value>
          </DataRow>
        ))}
      </DataGrid>
    );
  }
}

registerComponent<KosWidgetConfig>({
  id: "kos-widget",
  name: "kOS Widget",
  description:
    "Runs a kOS script on demand or on an interval and displays its [KOSDATA] output.",
  tags: ["kos", "telemetry", "custom"],
  defaultSize: { w: 6, h: 5 },
  minSize: { w: 3, h: 3 },
  openConfigOnAdd: true,
  component: KosWidgetComponent,
  configComponent: KosWidgetConfigComponent,
  dataRequirements: [],
  defaultConfig: {
    cpu: "",
    script: "",
    args: [],
    mode: "command",
    intervalMs: 1000,
  },
  actions: [],
  pushable: true,
});

export { KosWidgetComponent };

// ── Styles ────────────────────────────────────────────────────────────────

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--color-surface-panel);
  border-bottom: 1px solid var(--color-surface-raised);
  flex-shrink: 0;
`;

const Title = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const Spinner = styled.span`
  font-size: 14px;
  color: var(--color-text-muted);
`;

const RunButton = styled.button`
  background: var(--color-status-go-bg);
  border: 1px solid var(--color-status-go-bg);
  color: var(--color-status-go-fg);
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 2px;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: var(--color-status-go-bg);
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const ErrorBanner = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--color-status-alert-muted);
  border: none;
  border-bottom: 1px solid var(--color-border-strong);
  color: var(--color-status-nogo-fg);
  font-size: 11px;
  padding: 6px 10px;
  cursor: pointer;
  text-align: left;
  &:hover {
    background: var(--color-status-alert-muted);
  }
`;

const ErrorLabel = styled.span`
  font-weight: 700;
`;

const ErrorMeta = styled.span`
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-xs);
`;

const ErrorDetail = styled.pre`
  background: var(--color-status-alert-muted);
  color: var(--color-status-nogo-fg);
  font-size: 11px;
  padding: 8px 10px;
  margin: 0;
  white-space: pre-wrap;
  border-bottom: 1px solid var(--color-tag-dark-brown-bg);
`;

const DataGrid = styled(ScrollArea)`
  flex: 1;
  [data-scroll-area-inner] {
    padding: 6px 10px;
  }
`;

const DataRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
  font-size: 12px;
`;

const Key = styled.span`
  color: var(--color-text-muted);
`;

const Value = styled.span`
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
`;

const Empty = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-faint);
  font-size: 11px;
  padding: 12px;
  text-align: center;
`;

const PausedBanner = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--color-status-alert-muted);
  border-bottom: 1px solid var(--color-border-strong);
  color: var(--color-status-nogo-fg);
  font-size: 11px;
  padding: 6px 10px;
`;

const PausedText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const PausedLabel = styled.span`
  font-weight: 700;
`;

const PausedReason = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-status-nogo-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ReEnableButton = styled.button`
  background: transparent;
  border: 1px solid var(--color-status-nogo-fg);
  color: var(--color-status-nogo-fg);
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 2px;
  cursor: pointer;
  flex-shrink: 0;
  &:hover {
    background: var(--color-surface-raised);
  }
`;
