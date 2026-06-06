import type { ComponentProps, ConfigComponentProps } from "@gonogo/core";
import {
  registerComponent,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import { useKosScriptStatus } from "@gonogo/data";
import { logger } from "@gonogo/logger";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  ScrollArea,
} from "@gonogo/ui";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { KosScriptFrame } from "../kos/KosScriptFrame";
import {
  KOS_PROCESSORS_SCRIPT,
  KOS_PROCESSORS_TOPIC_ID,
  type KosProcessor,
} from "./processorsScript";

const PROCESSORS_KEY = `kos.compute.${KOS_PROCESSORS_TOPIC_ID}.processors`;
const DISPATCH_NOW_ACTION = `kos.compute.${KOS_PROCESSORS_TOPIC_ID}.dispatchNow`;
const RE_ENABLE_ACTION = `kos.compute.${KOS_PROCESSORS_TOPIC_ID}.reEnable`;

// Config is intentionally empty post-migration — the per-widget CPU /
// scriptName / interval all moved to the centralised kOS compute layer.
// Kept around so saved layouts with stale fields still type-check.
type KosProcessorsConfig = Record<string, never>;

function KosProcessorsComponent({
  w,
  h,
}: Readonly<ComponentProps<KosProcessorsConfig>>) {
  const payload = useDataValue<KosProcessor[]>("kos", PROCESSORS_KEY);
  const status = useKosScriptStatus(KOS_PROCESSORS_TOPIC_ID);
  const executeKos = useExecuteAction("kos");

  const dispatch = useCallback(() => {
    void executeKos(DISPATCH_NOW_ACTION);
  }, [executeKos]);
  const reEnable = useCallback(() => {
    void executeKos(RE_ENABLE_ACTION);
  }, [executeKos]);

  useEffect(() => {
    if (!payload) return;
    logger.info("kos-processors: payload received", {
      count: payload.length,
    });
  }, [payload]);

  return (
    <KosScriptFrame
      title="Processors"
      running={status.running}
      scriptError={status.scriptError}
      parseError={status.parseError}
      lastGoodAt={status.lastGoodAt}
      onRun={dispatch}
      runDisabled={status.running}
      paused={status.paused}
      pausedReason={status.scriptError?.message ?? null}
      onReEnable={reEnable}
    >
      {renderBody()}
    </KosScriptFrame>
  );

  function renderBody() {
    if (!payload) {
      return (
        <Placeholder>
          {status.running
            ? "Scanning…"
            : "Press Run to list vessel processors."}
        </Placeholder>
      );
    }
    if (payload.length === 0) {
      return <Placeholder>No kOS processors on this vessel.</Placeholder>;
    }

    const cols = w ?? 6;
    const rows = h ?? 8;
    const showFullRows = rows >= 6 && cols >= 5;
    const showCompactRows = !showFullRows && rows >= 4;

    if (!showFullRows && !showCompactRows) {
      const readyCount = payload.filter((p) => p.mode === "READY").length;
      return (
        <CompactSummary>
          <CompactCount>{payload.length}</CompactCount>
          <CompactSub>
            CPU{payload.length === 1 ? "" : "s"} · {readyCount} READY
          </CompactSub>
        </CompactSummary>
      );
    }

    if (showCompactRows) {
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
                </RowMain>
              </Row>
            );
          })}
        </List>
      );
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

function KosProcessorsConfigComponent(
  _props: Readonly<ConfigComponentProps<KosProcessorsConfig>>,
) {
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
        <FieldLabel>Active kOS CPU</FieldLabel>
        <FieldHint>
          The active CPU is set on the kOS data source. The processors script
          runs on that CPU and emits its `LIST PROCESSORS` output — any CPU on
          the vessel works because the listing is vessel-wide.
        </FieldHint>
      </Field>

      <Field>
        <ScriptHeader>
          <FieldLabel>Script (auto-deployed)</FieldLabel>
          <GhostButton type="button" onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </GhostButton>
        </ScriptHeader>
        <FieldHint>
          The kOS data source syncs this script to its conventional path
          automatically. Shown here for reference.
        </FieldHint>
        <ScriptBox>
          <pre>{KOS_PROCESSORS_SCRIPT}</pre>
        </ScriptBox>
      </Field>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const CompactSummary = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
`;

const CompactCount = styled.div`
  font-size: 28px;
  font-weight: 700;
  color: var(--color-status-go-fg);
`;

const CompactSub = styled.div`
  font-size: 11px;
  color: var(--color-text-muted);
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

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
  minSize: { w: 3, h: 3 },
  component: KosProcessorsComponent,
  configComponent: KosProcessorsConfigComponent,
  openConfigOnAdd: false,
  dataRequirements: [PROCESSORS_KEY],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { KosProcessorsComponent };
