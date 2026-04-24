import type { ComponentProps, ConfigComponentProps } from "@gonogo/core";
import { logger, registerComponent, useDataValue } from "@gonogo/core";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  PrimaryButton,
} from "@gonogo/ui";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { KosScriptFrame } from "../kos/KosScriptFrame";
import { useKosScriptPayload } from "../kos/useKosScriptPayload";
import { ShipDiagram } from "./ShipDiagram";
import {
  SHIP_MAP_SCRIPT,
  SHIP_MAP_SCRIPT_NAME,
  type ShipMapPart,
} from "./shipMapScript";

interface ShipMapConfig {
  /** kOS CPU tagname. Required — widget stays in an empty state until set. */
  cpu?: string;
  /**
   * Script name on the Archive volume (no extension). Defaults to
   * `shipmap`. Widget runs `RUN <scriptName>.` internally.
   */
  scriptName?: string;
  /** If true, re-run the script automatically when v.currentStage changes. */
  refreshOnStage?: boolean;
}

function ShipMapComponent({ config }: Readonly<ComponentProps<ShipMapConfig>>) {
  const cpu = config?.cpu ?? "";
  const scriptName = config?.scriptName ?? SHIP_MAP_SCRIPT_NAME;
  const refreshOnStage = config?.refreshOnStage !== false;

  const {
    payload,
    raw,
    error: scriptError,
    parseError,
    running,
    lastGoodAt,
    dispatch,
  } = useKosScriptPayload<ShipMapPart[]>({
    cpu,
    script: scriptName,
    args: [],
    field: "parts",
    mode: "command",
  });

  // Auto-refresh on staging. Reads v.currentStage; when it changes and the
  // widget is configured, re-run the script. Debounced via stage-value diff.
  const currentStage = useDataValue("data", "v.currentStage");
  const lastStageRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!refreshOnStage) return;
    if (currentStage === undefined) return;
    const prev = lastStageRef.current;
    lastStageRef.current = currentStage;
    if (prev === undefined) return;
    if (prev === currentStage) return;
    if (!cpu) return;
    logger.info("ship-map: restaging, re-running script", {
      previousStage: prev,
      currentStage,
    });
    dispatch();
  }, [currentStage, refreshOnStage, cpu, dispatch]);

  // Diagnostic logging — makes the first-time iteration cheap.
  useEffect(() => {
    if (!payload) return;
    logger.info("ship-map: payload received", {
      parts: payload.length,
      rawKeys: raw ? Object.keys(raw) : [],
    });
  }, [payload, raw]);

  // Highlight the hottest part (if Telemachus is shipping thermal data).
  // Falls back to null when therm.* isn't emitting yet.
  const hottestPartName = useDataValue("data", "therm.hottestPartName");

  // Measure the container so the SVG picks a size without a hardcoded value.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 320, h: 240 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const rect = e.contentRect;
        if (rect.width > 0 && rect.height > 0) {
          setSize({
            w: Math.floor(rect.width),
            h: Math.floor(rect.height),
          });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const notConfigured = !cpu;

  return (
    <KosScriptFrame
      title={config?.cpu ? `Ship Map · ${config.cpu}` : "Ship Map"}
      running={running}
      scriptError={scriptError}
      parseError={parseError}
      lastGoodAt={lastGoodAt}
      onRun={dispatch}
      runDisabled={running || notConfigured}
    >
      {notConfigured ? (
        <Placeholder>
          Configure the kOS CPU tagname and save{" "}
          <code>{SHIP_MAP_SCRIPT_NAME}.ks</code> to the Archive volume. The
          script is in the widget's config.
        </Placeholder>
      ) : !payload ? (
        <Placeholder>
          {running ? "Running shipmap…" : "No ship data yet. Press Run."}
        </Placeholder>
      ) : (
        <>
          <Meta>
            {payload.length} part{payload.length === 1 ? "" : "s"}
            {lastGoodAt && (
              <MetaTag>
                · updated {formatAge(Date.now() - lastGoodAt)} ago
              </MetaTag>
            )}
            {hottestPartName !== undefined && (
              <MetaTag>· hot: {hottestPartName}</MetaTag>
            )}
          </Meta>
          <DiagramWrap ref={wrapRef}>
            <ShipDiagram
              parts={payload}
              highlight={
                typeof hottestPartName === "string" ? hottestPartName : null
              }
              width={size.w}
              height={size.h}
            />
          </DiagramWrap>
        </>
      )}
    </KosScriptFrame>
  );
}

// ── Config ────────────────────────────────────────────────────────────────────

function ShipMapConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<ShipMapConfig>>) {
  const [cpu, setCpu] = useState(config?.cpu ?? "");
  const [scriptName, setScriptName] = useState(
    config?.scriptName ?? SHIP_MAP_SCRIPT_NAME,
  );
  const [refreshOnStage, setRefreshOnStage] = useState(
    config?.refreshOnStage !== false,
  );
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard?.writeText(SHIP_MAP_SCRIPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="ship-map-cpu">kOS CPU tagname</FieldLabel>
        <Input
          id="ship-map-cpu"
          type="text"
          value={cpu}
          placeholder="e.g. MyShipCPU"
          onChange={(e) => setCpu(e.target.value)}
        />
        <FieldHint>
          The tagname of the kOS part on your vessel. Set via the kOS part's
          right-click menu in KSP.
        </FieldHint>
      </Field>

      <Field>
        <FieldLabel htmlFor="ship-map-script-name">Script name</FieldLabel>
        <Input
          id="ship-map-script-name"
          type="text"
          value={scriptName}
          onChange={(e) => setScriptName(e.target.value)}
        />
        <FieldHint>
          No file extension. The widget runs <code>RUN {scriptName}.</code>
          on the target CPU. Defaults to <code>shipmap</code>.
        </FieldHint>
      </Field>

      <Field>
        <FieldLabel>Auto-refresh on staging</FieldLabel>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={refreshOnStage}
            onChange={(e) => setRefreshOnStage(e.target.checked)}
          />
          <span>Re-run when v.currentStage changes</span>
        </label>
      </Field>

      <Field>
        <ScriptHeader>
          <FieldLabel>Script</FieldLabel>
          <GhostButton type="button" onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </GhostButton>
        </ScriptHeader>
        <FieldHint>
          Paste this into <code>{scriptName}.ks</code> on your kOS Archive
          volume. Edit freely — the contract is one line of the form
          <code>[KOSDATA]parts=&lt;json-array&gt;[/KOSDATA]</code>.
        </FieldHint>
        <ScriptBox>
          <pre>{SHIP_MAP_SCRIPT}</pre>
        </ScriptBox>
      </Field>

      <PrimaryButton
        onClick={() => onSave({ cpu, scriptName, refreshOnStage })}
      >
        Save
      </PrimaryButton>
    </ConfigForm>
  );
}

function formatAge(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Placeholder = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 11px;
  padding: 12px;
  text-align: center;
  code {
    background: #1a1a1a;
    padding: 1px 4px;
    border-radius: 2px;
    color: #cfe;
  }
`;

const Meta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: #141414;
  border-bottom: 1px solid #1f1f1f;
  font-size: 10px;
  color: #888;
`;

const MetaTag = styled.span`
  color: #555;
`;

const DiagramWrap = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  background: #050505;
  svg {
    display: block;
    flex: 1;
  }
`;

const ScriptHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const ScriptBox = styled.div`
  max-height: 260px;
  overflow: auto;
  background: #0a0a0a;
  border: 1px solid #222;
  border-radius: 3px;
  padding: 6px 8px;
  font-family: monospace;
  font-size: 11px;
  color: #cfe;
  pre {
    margin: 0;
    white-space: pre;
  }
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<ShipMapConfig>({
  id: "ship-map",
  name: "Ship Map",
  description:
    "kOS-driven part diagram of the active vessel. The widget runs a saved kerboscript on-demand (and on staging) and plots every part as a dot, sized by mass, edges following the parent/child tree. Highlights the part currently reported as hottest by Telemachus.",
  tags: ["kos", "telemetry", "ship"],
  defaultSize: { w: 8, h: 10 },
  component: ShipMapComponent,
  configComponent: ShipMapConfigComponent,
  openConfigOnAdd: true,
  dataRequirements: ["v.currentStage", "therm.hottestPartName"],
  defaultConfig: {
    cpu: "",
    scriptName: SHIP_MAP_SCRIPT_NAME,
    refreshOnStage: true,
  },
  actions: [],
  pushable: true,
});

export { ShipMapComponent };
