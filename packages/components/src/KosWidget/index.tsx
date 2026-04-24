import type { ComponentProps } from "@gonogo/core";
import { registerComponent } from "@gonogo/core";
import { useKosWidget } from "@gonogo/data";
import { useState } from "react";
import styled from "styled-components";
import { KosWidgetConfigComponent } from "./KosWidgetConfig";
import type { KosWidgetConfig } from "./types";

function formatAge(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

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
  const { data, error, running, lastGoodAt, dispatch } = useKosWidget({
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
      {error && (
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
      {errorOpen && error && <ErrorDetail>{error.message}</ErrorDetail>}
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
  background: #0d0d0d;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  overflow: hidden;
  font-family: monospace;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #141414;
  border-bottom: 1px solid #1f1f1f;
  flex-shrink: 0;
`;

const Title = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #888;
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const Spinner = styled.span`
  font-size: 14px;
  color: #888;
`;

const RunButton = styled.button`
  background: #1f3a1f;
  border: 1px solid #2e5a2e;
  color: #cfe;
  font-family: monospace;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 2px;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: #2e5a2e;
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
  background: #3a1a1a;
  border: none;
  border-bottom: 1px solid #4a2a2a;
  color: #fbb;
  font-family: monospace;
  font-size: 11px;
  padding: 6px 10px;
  cursor: pointer;
  text-align: left;
  &:hover {
    background: #4a1e1e;
  }
`;

const ErrorLabel = styled.span`
  font-weight: 700;
`;

const ErrorMeta = styled.span`
  color: #c88;
  font-size: 10px;
`;

const ErrorDetail = styled.pre`
  background: #1a0d0d;
  color: #fbb;
  font-size: 11px;
  padding: 8px 10px;
  margin: 0;
  white-space: pre-wrap;
  border-bottom: 1px solid #2a1010;
`;

const DataGrid = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 6px 10px;
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
  color: #777;
`;

const Value = styled.span`
  color: #ccc;
  font-variant-numeric: tabular-nums;
`;

const Empty = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #555;
  font-size: 11px;
  padding: 12px;
  text-align: center;
`;
