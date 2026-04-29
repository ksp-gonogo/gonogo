import type { ComponentProps, ConfigComponentProps } from "@gonogo/core";
import { logger, registerComponent, useDataValue } from "@gonogo/core";
import { hashKosScript } from "@gonogo/data";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  PrimaryButton,
  Switch,
} from "@gonogo/ui";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { KosCpuPicker } from "../kos/KosCpuPicker";
import { KosScriptFrame } from "../kos/KosScriptFrame";
import { useKosScriptPayload } from "../kos/useKosScriptPayload";
import { ShipDiagram } from "./ShipDiagram";
import {
  SHIP_MAP_SCRIPT,
  SHIP_MAP_SCRIPT_NAME,
  type ShipMapPart,
} from "./shipMapScript";

const SHIP_MAP_SCRIPT_VERSION = hashKosScript(SHIP_MAP_SCRIPT);

interface ShipMapConfig {
  /** kOS CPU tagname. Required — widget stays in an empty state until set. */
  cpu?: string;
  /**
   * Path of the saved kerboscript on the kOS Archive volume. The `.ks`
   * extension and subpaths (`widget_scripts/shipmap`) are both fine —
   * the widget dispatches via kOS's RUNPATH under the hood. Defaults to
   * `shipmap`.
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
    disabled,
    disabledReason,
    reEnable,
  } = useKosScriptPayload<ShipMapPart[]>({
    cpu,
    script: scriptName,
    args: [],
    field: "parts",
    mode: "command",
    managed: { body: SHIP_MAP_SCRIPT, version: SHIP_MAP_SCRIPT_VERSION },
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
      payload,
      rawKeys: raw ? Object.keys(raw) : [],
    });
  }, [payload, raw]);

  // Highlight the hottest part (if Telemachus is shipping thermal data).
  // Falls back to null when therm.* isn't emitting yet.
  const hottestPartName = useDataValue("data", "therm.hottestPartName");

  // Measure the container so the SVG picks a size without a hardcoded value.
  // State-backed ref (rather than useRef) so the effect re-attaches when
  // DiagramWrap mounts — it's only rendered once `payload` exists, so a
  // plain useRef + [] deps would never see the element.
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 320, h: 240 });
  useEffect(() => {
    if (!wrapEl || typeof ResizeObserver === "undefined") return;
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
    ro.observe(wrapEl);
    return () => ro.disconnect();
  }, [wrapEl]);

  // Chip-hover overrides the hottest-part highlight so users can preview
  // exactly where each tagged part lives. Click locks the selection;
  // re-clicking clears it.
  const [stickyTag, setStickyTag] = useState<string | null>(null);
  const [hoverTag, setHoverTag] = useState<string | null>(null);

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
          {running ? "Running shipmap…" : "No ship data yet. Press Run."}
        </Placeholder>
      );
    }
    const tags = Array.from(
      new Set(
        payload
          .map((p) => p.tag)
          .filter((t): t is string => typeof t === "string" && t.length > 0),
      ),
    ).sort();
    const activeTag = hoverTag ?? stickyTag;
    const highlight =
      activeTag ??
      (typeof hottestPartName === "string" ? hottestPartName : null);
    return (
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
        {tags.length > 0 && (
          <TagRow>
            <TagRowLabel>tags:</TagRowLabel>
            {tags.map((t) => (
              <TagChip
                key={t}
                type="button"
                $active={stickyTag === t}
                onMouseEnter={() => setHoverTag(t)}
                onMouseLeave={() => setHoverTag(null)}
                onFocus={() => setHoverTag(t)}
                onBlur={() => setHoverTag(null)}
                onClick={() =>
                  setStickyTag((current) => (current === t ? null : t))
                }
                aria-pressed={stickyTag === t}
              >
                {t}
              </TagChip>
            ))}
          </TagRow>
        )}
        <DiagramWrap ref={setWrapEl}>
          <ShipDiagram
            parts={payload}
            highlight={highlight}
            width={size.w}
            height={size.h}
          />
        </DiagramWrap>
      </>
    );
  }
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
        <FieldLabel htmlFor="ship-map-cpu">kOS CPU</FieldLabel>
        <KosCpuPicker id="ship-map-cpu" value={cpu} onChange={setCpu} />
        <FieldHint>
          Pick from previously-named CPUs or add a new one. The tagname is set
          via the kOS part&apos;s right-click menu in KSP.
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
          Path to the saved script on your kOS volume. The widget runs{" "}
          <code>RUNPATH("{scriptName}").</code> Prefer the Archive (
          <code>0:/…</code>) — the CPU&apos;s local volume gets wiped on reverts
          and isn&apos;t always populated. Subpaths and the <code>.ks</code>{" "}
          extension are optional. Defaults to <code>shipmap</code>.
        </FieldHint>
      </Field>

      <Field>
        <FieldLabel>Auto-refresh on staging</FieldLabel>
        <Switch
          checked={refreshOnStage}
          onChange={setRefreshOnStage}
          label="Re-run when v.currentStage changes"
        />
      </Field>

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
          automatically — no copy-paste needed. Shown here for reference and for
          hand-editing the on-volume copy if you want to experiment.
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

const TagRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--color-surface-panel);
  border-bottom: 1px solid var(--color-surface-raised);
  font-size: var(--font-size-xs);
`;

const TagRowLabel = styled.span`
  color: var(--color-text-faint);
  margin-right: 2px;
`;

const TagChip = styled.button<{ $active: boolean }>`
  font-size: var(--font-size-xs);
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid ${(p) => (p.$active ? "var(--color-tag-cyan-fg)" : "var(--color-border-subtle)")};
  background: ${(p) => (p.$active ? "var(--color-border-subtle)" : "var(--color-surface-panel)")};
  color: ${(p) => (p.$active ? "var(--color-tag-cyan-fg)" : "var(--color-text-muted)")};
  cursor: pointer;
  &:hover {
    border-color: var(--color-tag-cyan-fg);
    color: var(--color-tag-cyan-fg);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const Meta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--color-surface-panel);
  border-bottom: 1px solid var(--color-surface-raised);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;

const MetaTag = styled.span`
  color: var(--color-text-faint);
`;

const DiagramWrap = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  background: var(--color-surface-app);
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
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--color-status-go-fg);
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
