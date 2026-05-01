import type { ComponentProps, ConfigComponentProps } from "@gonogo/core";
import { logger, registerComponent } from "@gonogo/core";
import { hashKosScript } from "@gonogo/data";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  PrimaryButton,
  ScrollArea,
  Switch,
} from "@gonogo/ui";
import { type ReactNode, useEffect, useState } from "react";
import styled from "styled-components";
import { KosCpuPicker } from "../kos/KosCpuPicker";
import { KosScriptFrame } from "../kos/KosScriptFrame";
import { useKosScriptPayload } from "../kos/useKosScriptPayload";
import {
  KOS_PROCESSORS_SCRIPT,
  KOS_PROCESSORS_SCRIPT_NAME,
  type KosProcessor,
} from "./processorsScript";

interface KosProcessorsConfig {
  /** kOS CPU tagname this widget runs the listing script on. */
  cpu?: string;
  /** Path of the saved kerboscript on the kOS Archive volume. */
  scriptName?: string;
  /** Auto-refresh by re-running the script on a timer. Default true. */
  autoRefresh?: boolean;
  /** Poll interval in ms when autoRefresh is true. Default 5000. */
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 5000;
const KOS_PROCESSORS_SCRIPT_VERSION = hashKosScript(KOS_PROCESSORS_SCRIPT);
/** Don't let users dial below 1s — running a kerboscript every tick can
 *  starve other scripts on the same CPU. */
const MIN_INTERVAL_MS = 1000;

function KosProcessorsComponent({
  config,
}: Readonly<ComponentProps<KosProcessorsConfig>>) {
  const cpu = config?.cpu ?? "";
  const scriptName = config?.scriptName ?? KOS_PROCESSORS_SCRIPT_NAME;
  const autoRefresh = config?.autoRefresh !== false;
  const intervalMs = Math.max(
    MIN_INTERVAL_MS,
    config?.intervalMs ?? DEFAULT_INTERVAL_MS,
  );

  const {
    payload,
    error: scriptError,
    parseError,
    running,
    lastGoodAt,
    dispatch,
    disabled,
    disabledReason,
    reEnable,
  } = useKosScriptPayload<KosProcessor[]>({
    cpu,
    script: scriptName,
    args: [],
    field: "processors",
    mode: autoRefresh ? "interval" : "command",
    intervalMs: autoRefresh ? intervalMs : undefined,
    managed: {
      body: KOS_PROCESSORS_SCRIPT,
      version: KOS_PROCESSORS_SCRIPT_VERSION,
    },
  });

  useEffect(() => {
    if (!payload) return;
    logger.info("kos-processors: payload received", {
      count: payload.length,
    });
  }, [payload]);

  const notConfigured = !cpu;

  return (
    <KosScriptFrame
      title={cpu ? `Processors · ${cpu}` : "Processors"}
      running={running}
      scriptError={scriptError}
      parseError={parseError}
      lastGoodAt={lastGoodAt}
      onRun={dispatch}
      runDisabled={running || notConfigured}
      paused={disabled}
      pausedReason={disabledReason}
      onReEnable={reEnable}
    >
      {renderBody()}
    </KosScriptFrame>
  );

  function renderBody() {
    if (notConfigured) {
      return (
        <Placeholder>
          Pick a kOS CPU in the widget&apos;s config to start.
        </Placeholder>
      );
    }
    if (!payload) {
      return (
        <Placeholder>
          {running ? "Scanning…" : "Press Run to list vessel processors."}
        </Placeholder>
      );
    }
    if (payload.length === 0) {
      return <Placeholder>No kOS processors on this vessel.</Placeholder>;
    }
    return (
      <List>
        {payload.map((p, i) => {
          const key = p.partUid || `${p.tag || "untagged"}-${i}`;
          const label = p.tag || "untagged";
          return (
            <Row key={key}>
              <ModeDot
                $mode={p.mode}
                title={`mode: ${p.mode}`}
                aria-label={`mode ${p.mode.toLowerCase()}`}
              />
              <RowMain>
                <RowTitle>
                  {p.tag ? label : <Untagged>{label}</Untagged>}
                  <RowMode $mode={p.mode}>{p.mode}</RowMode>
                </RowTitle>
                {p.partTitle && <RowSub>{p.partTitle}</RowSub>}
                <RowMeta>
                  {p.volume && <Pill>vol · {p.volume}</Pill>}
                  {p.bootFile && <Pill>boot · {p.bootFile}</Pill>}
                </RowMeta>
              </RowMain>
            </Row>
          );
        })}
      </List>
    );
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

function KosProcessorsConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<KosProcessorsConfig>>) {
  const [cpu, setCpu] = useState(config?.cpu ?? "");
  const [scriptName, setScriptName] = useState(
    config?.scriptName ?? KOS_PROCESSORS_SCRIPT_NAME,
  );
  const [autoRefresh, setAutoRefresh] = useState(config?.autoRefresh !== false);
  const [intervalText, setIntervalText] = useState(
    String(config?.intervalMs ?? DEFAULT_INTERVAL_MS),
  );
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard?.writeText(KOS_PROCESSORS_SCRIPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="kos-procs-cpu">kOS CPU</FieldLabel>
        <KosCpuPicker id="kos-procs-cpu" value={cpu} onChange={setCpu} />
        <FieldHint>
          Any kOS CPU on the vessel works — the script just calls{" "}
          <code>LIST PROCESSORS</code>, which sees every CPU regardless of which
          one runs it.
        </FieldHint>
      </Field>

      <Field>
        <FieldLabel htmlFor="kos-procs-script-name">Script name</FieldLabel>
        <Input
          id="kos-procs-script-name"
          type="text"
          value={scriptName}
          onChange={(e) => setScriptName(e.target.value)}
        />
        <FieldHint>
          Path to the saved script on your kOS volume. Prefer the Archive (
          <code>0:/…</code>). Defaults to{" "}
          <code>{KOS_PROCESSORS_SCRIPT_NAME}</code>.
        </FieldHint>
      </Field>

      <Field>
        <FieldLabel>Auto-refresh</FieldLabel>
        <Switch
          checked={autoRefresh}
          onChange={setAutoRefresh}
          label="Re-run the listing script on a timer"
        />
        <FieldHint>
          Off by request — the widget then only updates when you press Run.
        </FieldHint>
      </Field>

      {autoRefresh && (
        <Field>
          <FieldLabel htmlFor="kos-procs-interval">Interval (ms)</FieldLabel>
          <Input
            id="kos-procs-interval"
            type="number"
            min={MIN_INTERVAL_MS}
            step={500}
            value={intervalText}
            onChange={(e) => setIntervalText(e.target.value)}
          />
          <FieldHint>
            Default {DEFAULT_INTERVAL_MS} ms. Below {MIN_INTERVAL_MS} ms is
            clamped — running every tick starves other scripts on the same CPU.
          </FieldHint>
        </Field>
      )}

      <Field>
        <ScriptHeader>
          <FieldLabel>Script (auto-deployed)</FieldLabel>
          <GhostButton type="button" onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </GhostButton>
        </ScriptHeader>
        <FieldHint>
          The widget syncs this script to{" "}
          <code>
            {scriptName.endsWith(".ks") ? scriptName : `${scriptName}.ks`}
          </code>{" "}
          automatically — no copy-paste needed. Shown here for reference.
        </FieldHint>
        <ScriptBox>
          <pre>{KOS_PROCESSORS_SCRIPT}</pre>
        </ScriptBox>
      </Field>

      <PrimaryButton
        onClick={() =>
          onSave({
            cpu,
            scriptName,
            autoRefresh,
            intervalMs: Math.max(
              MIN_INTERVAL_MS,
              Number.parseInt(intervalText, 10) || DEFAULT_INTERVAL_MS,
            ),
          })
        }
      >
        Save
      </PrimaryButton>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Placeholder = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-dim);
  font-size: 11px;
  padding: 12px;
  text-align: center;
  code {
    background: var(--color-surface-raised);
    padding: 1px 4px;
    border-radius: 2px;
    color: var(--color-status-go-fg);
  }
`;

const ListScroll = styled(ScrollArea)`
  flex: 1;
`;

const ListUl = styled.ul`
  list-style: none;
  margin: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

function List({ children }: { children: ReactNode }) {
  return (
    <ListScroll>
      <ListUl>{children}</ListUl>
    </ListScroll>
  );
}

const Row = styled.li`
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-surface-raised);
  border-radius: 3px;
`;

const ModeDot = styled.span<{ $mode: string }>`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 4px;
  background: ${(p) => modeColor(p.$mode)};
  flex: 0 0 auto;
  box-shadow: 0 0 6px ${(p) => modeColor(p.$mode)};
`;

const RowMain = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
`;

const RowTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-status-go-fg);
  font-weight: 600;
`;

const RowMode = styled.span<{ $mode: string }>`
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  color: ${(p) => modeColor(p.$mode)};
`;

const RowSub = styled.div`
  font-size: 11px;
  color: var(--color-text-muted);
`;

const RowMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
`;

const Pill = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  padding: 1px 5px;
  border-radius: 999px;
`;

const Untagged = styled.span`
  color: var(--color-text-dim);
  font-style: italic;
  font-weight: 400;
`;

const ScriptHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const ScriptBox = styled(ScrollArea)`
  max-height: 260px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  font-size: 11px;
  color: var(--color-status-go-fg);
  pre {
    margin: 0;
    padding: 6px 8px;
    white-space: pre;
  }
`;

function modeColor(mode: string): string {
  switch (mode) {
    case "READY":
      return "var(--color-accent-fg)";
    case "STARVED":
      return "var(--color-status-warning-bg)";
    case "OFF":
      return "var(--color-text-dim)";
    default:
      return "var(--color-text-muted)";
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<KosProcessorsConfig>({
  id: "kos-processors",
  name: "kOS Processors",
  description:
    "Lists every kOS CPU on the active vessel — tag, run mode, current volume, and boot file. Driven by a saved kerboscript that calls `LIST PROCESSORS`; press Run to refresh.",
  tags: ["kos", "fleet"],
  defaultSize: { w: 6, h: 8 },
  component: KosProcessorsComponent,
  configComponent: KosProcessorsConfigComponent,
  openConfigOnAdd: true,
  dataRequirements: [],
  defaultConfig: {
    cpu: "",
    scriptName: KOS_PROCESSORS_SCRIPT_NAME,
    autoRefresh: true,
    intervalMs: DEFAULT_INTERVAL_MS,
  },
  actions: [],
  pushable: true,
});

export { KosProcessorsComponent };
