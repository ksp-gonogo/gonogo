import type { ComponentProps, ConfigComponentProps } from "@gonogo/core";
import {
  formatAge,
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
  PrimaryButton,
  ScrollArea,
  Switch,
} from "@gonogo/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { KosScriptFrame } from "../kos/KosScriptFrame";
import { ShipDiagram } from "./ShipDiagram";
import {
  SHIP_MAP_SCRIPT,
  SHIP_MAP_TOPIC_ID,
  type ShipMapPart,
} from "./shipMapScript";

const PARTS_KEY = `kos.compute.${SHIP_MAP_TOPIC_ID}.parts`;
const DISPATCH_NOW_ACTION = `kos.compute.${SHIP_MAP_TOPIC_ID}.dispatchNow`;
const RE_ENABLE_ACTION = `kos.compute.${SHIP_MAP_TOPIC_ID}.reEnable`;

interface ShipMapConfig {
  /** If true, re-run the script automatically when v.currentStage changes. */
  refreshOnStage?: boolean;
}

function ShipMapComponent({ config }: Readonly<ComponentProps<ShipMapConfig>>) {
  const refreshOnStage = config?.refreshOnStage !== false;

  // Centralised compute fanout: one loop per registered script, regardless
  // of how many ShipMaps are mounted. The active CPU lives on the kOS data
  // source's config now (no per-widget CPU picker).
  const payload = useDataValue<ShipMapPart[]>("kos", PARTS_KEY);
  const status = useKosScriptStatus(SHIP_MAP_TOPIC_ID);
  const executeKos = useExecuteAction("kos");

  const dispatch = useCallback(() => {
    void executeKos(DISPATCH_NOW_ACTION);
  }, [executeKos]);
  const reEnable = useCallback(() => {
    void executeKos(RE_ENABLE_ACTION);
  }, [executeKos]);

  // Auto-refresh on staging. Reads v.currentStage; when it changes, ask the
  // central loop for a fresh sample without waiting for the next interval.
  const currentStage = useDataValue("data", "v.currentStage");
  const lastStageRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!refreshOnStage) return;
    if (currentStage === undefined) return;
    const prev = lastStageRef.current;
    lastStageRef.current = currentStage;
    if (prev === undefined) return;
    if (prev === currentStage) return;
    logger.info("ship-map: restaging, re-running script", {
      previousStage: prev,
      currentStage,
    });
    dispatch();
  }, [currentStage, refreshOnStage, dispatch]);

  // Diagnostic logging — makes the first-time iteration cheap.
  useEffect(() => {
    if (!payload) return;
    logger.info("ship-map: payload received", {
      parts: payload.length,
      payload,
    });
  }, [payload]);

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

  return (
    <KosScriptFrame
      title="Ship Map"
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
          {status.running ? "Running shipmap…" : "No ship data yet. Press Run."}
        </Placeholder>
      );
    }
    const tags = Array.from(
      new Set(
        payload
          .map((p) => p.tag)
          .filter((t): t is string => typeof t === "string" && t.length > 0),
      ),
    ).sort((a, b) => a.localeCompare(b));
    const activeTag = hoverTag ?? stickyTag;
    const highlight =
      activeTag ??
      (typeof hottestPartName === "string" ? hottestPartName : null);
    return (
      <>
        <Meta>
          {payload.length} part{payload.length === 1 ? "" : "s"}
          {status.lastGoodAt && (
            <MetaTag>
              · updated {formatAge(Date.now() - status.lastGoodAt)} ago
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
        <FieldLabel>Active kOS CPU</FieldLabel>
        <FieldHint>
          The active CPU is set on the kOS data source (open the data source
          config). It applies to every centralised kOS widget so two Ship Maps
          share a single dispatch per cycle.
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
          The kOS data source syncs this script to its conventional path
          automatically — no copy-paste needed. Shown here for reference and for
          hand-editing the on-volume copy if you want to experiment.
        </FieldHint>
        <ScriptBox>
          <pre>{SHIP_MAP_SCRIPT}</pre>
        </ScriptBox>
      </Field>

      <PrimaryButton onClick={() => onSave({ refreshOnStage })}>
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

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<ShipMapConfig>({
  id: "ship-map",
  name: "Ship Map",
  description:
    "kOS-driven part diagram of the active vessel. The widget runs a saved kerboscript on-demand (and on staging) and plots every part as a dot, sized by mass, edges following the parent/child tree. Highlights the part currently reported as hottest by Telemachus.",
  tags: ["kos", "telemetry", "ship"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 5, h: 5 },
  component: ShipMapComponent,
  configComponent: ShipMapConfigComponent,
  openConfigOnAdd: true,
  dataRequirements: [PARTS_KEY, "v.currentStage", "therm.hottestPartName"],
  defaultConfig: {
    refreshOnStage: true,
  },
  actions: [],
  pushable: true,
});

export { ShipMapComponent };
