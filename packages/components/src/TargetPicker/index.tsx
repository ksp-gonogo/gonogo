import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@gonogo/core";
import {
  formatAge,
  formatDistance,
  registerComponent,
  useActionInput,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import { hashKosScript } from "@gonogo/data";
import {
  Button,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  Panel,
  PanelTitle,
  PrimaryButton,
  ScrollArea,
  Tabs,
} from "@gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { KosCpuPicker } from "../kos/KosCpuPicker";
import { useKosScriptPayload } from "../kos/useKosScriptPayload";
import { useCelestialBodies } from "../SystemView/useCelestialBodies";
import {
  VESSEL_LIST_SCRIPT,
  VESSEL_LIST_SCRIPT_NAME,
  type VesselListEntry,
} from "./vesselListScript";

const VESSEL_LIST_SCRIPT_VERSION = hashKosScript(VESSEL_LIST_SCRIPT);

interface TargetPickerConfig {
  /**
   * kOS CPU tagname for the Vessels tab. Empty → Vessels tab shows a
   * "configure kOS" hint and the rest of the widget still works.
   */
  cpu?: string;
  /** Path of the bundled vessel-list script on the kOS Archive volume. */
  scriptName?: string;
}
type TabId = "bodies" | "vessels" | "current";

const targetPickerActions = [
  {
    id: "clear-target",
    label: "Clear target",
    accepts: ["button"],
    description: "Clears the current KSP target via tar.clearTarget.",
  },
] as const satisfies readonly ActionDefinition[];
type TargetPickerActions = typeof targetPickerActions;

function TargetPickerComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<TargetPickerConfig>>) {
  const cpu = config?.cpu ?? "";
  const scriptName = config?.scriptName ?? VESSEL_LIST_SCRIPT_NAME;
  const bodies = useCelestialBodies();
  const tarName = useDataValue("data", "tar.name") as string | undefined;
  const tarType = useDataValue("data", "tar.type") as string | undefined;
  const tarDistance = useDataValue("data", "tar.distance");
  const tarRelVel = useDataValue("data", "tar.o.relativeVelocity");
  const execute = useExecuteAction("data");

  const [tab, setTab] = useState<TabId>("bodies");
  const [filter, setFilter] = useState("");

  useActionInput<TargetPickerActions>({
    "clear-target": (payload) => {
      if (payload.kind !== "button" || payload.value !== true) return;
      void execute("tar.clearTarget");
    },
  });

  const targetBody = (index: number) =>
    void execute(`tar.setTargetBody[${index}]`);
  const clearTarget = () => void execute("tar.clearTarget");

  // ── kOS-backed vessel listing ────────────────────────────────────────────
  // The script accepts a single string parameter — either an empty string
  // (list-only) or a vessel name to SET TARGET TO. Click handlers stash a
  // pending name; an effect dispatches once the args have re-resolved on
  // the next render, then clears the pending state so subsequent manual
  // refreshes don't accidentally re-target.
  const [pendingTargetName, setPendingTargetName] = useState("");
  const argsForKos = useMemo(
    () => [{ type: "string" as const, value: pendingTargetName }],
    [pendingTargetName],
  );
  const {
    payload: vessels,
    error: kosError,
    parseError: kosParseError,
    running: kosRunning,
    lastGoodAt: kosLastGoodAt,
    dispatch: kosDispatch,
    disabled: kosDisabled,
    disabledReason: kosDisabledReason,
  } = useKosScriptPayload<VesselListEntry[]>({
    cpu,
    script: scriptName,
    args: argsForKos,
    field: "vessels",
    mode: "command",
    managed: { body: VESSEL_LIST_SCRIPT, version: VESSEL_LIST_SCRIPT_VERSION },
  });

  // After the args render-cycle has caught up, fire the dispatch and reset
  // the pending name so the next manual refresh defaults back to list-only.
  // Dispatching directly inside the click handler would race the args ref
  // — useKosWidget reads argsRef.current, which doesn't update until the
  // next render after setState.
  const dispatchPendingRef = useRef(false);
  useEffect(() => {
    if (pendingTargetName.length === 0) return;
    if (dispatchPendingRef.current) return;
    dispatchPendingRef.current = true;
    kosDispatch();
    // Reset after dispatch — by the time the next render happens, the
    // args ref has already been used.
    setPendingTargetName("");
    dispatchPendingRef.current = false;
  }, [pendingTargetName, kosDispatch]);

  const refreshVessels = () => {
    // List-only refresh — args already empty.
    if (cpu) kosDispatch();
  };
  const targetVessel = (name: string) => {
    if (!cpu) return;
    setPendingTargetName(name);
  };

  const filterText = filter.trim().toLowerCase();
  const isFiltering = filterText.length > 0;

  const namedBodies = useMemo(
    () => bodies.filter((b) => b.name !== null),
    [bodies],
  );

  const filteredBodies = useMemo(() => {
    if (!isFiltering) return namedBodies;
    return namedBodies.filter((b) =>
      (b.name as string).toLowerCase().includes(filterText),
    );
  }, [namedBodies, filterText, isFiltering]);

  // Group bodies by their reference body for the tree-style rendering.
  // Anything without a reference body is treated as a top-level root (the
  // star, in stock Kerbol). The tree is shallow — at most parent → children
  // → grandchildren — so a sorted-children Map is enough. We always build
  // the tree from the full body set so a filter that matches a child but
  // not its parent still surfaces the child (we'll fall back to a flat list
  // when filtering).
  const tree = useMemo(() => {
    const childrenOf = new Map<string, typeof namedBodies>();
    const roots: typeof namedBodies = [];
    for (const body of namedBodies) {
      if (body.referenceBody === null) {
        roots.push(body);
        continue;
      }
      const bucket = childrenOf.get(body.referenceBody) ?? [];
      bucket.push(body);
      childrenOf.set(body.referenceBody, bucket);
    }
    return { roots, childrenOf };
  }, [namedBodies]);

  const bodiesContent = (
    <BodiesTab>
      <FilterInput
        type="search"
        placeholder="Filter bodies"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter bodies"
      />
      {bodies.length === 0 ? (
        <Hint>Waiting for body data…</Hint>
      ) : isFiltering ? (
        // Flat-list mode while filtering — a tree-walk would hide a matching
        // child whose parent didn't match the filter.
        <BodyList>
          {filteredBodies.length === 0 ? (
            <Hint>No bodies match.</Hint>
          ) : (
            filteredBodies.map((body) => (
              <BodyRow
                key={body.index}
                type="button"
                $depth={0}
                $current={body.name === tarName}
                onClick={() => targetBody(body.index)}
              >
                <BodyName>{body.name ?? "(unnamed)"}</BodyName>
                {body.name === tarName && <BodyTag>TARGET</BodyTag>}
              </BodyRow>
            ))
          )}
        </BodyList>
      ) : (
        <BodyList>
          {tree.roots.map((root) => (
            <BodyTreeNode
              key={root.index}
              body={root}
              childrenOf={tree.childrenOf}
              depth={0}
              currentTargetName={tarName}
              onTarget={targetBody}
            />
          ))}
        </BodyList>
      )}
    </BodiesTab>
  );

  const vesselsContent = (() => {
    if (!cpu) {
      return (
        <Hint>
          Vessels tab needs a kOS CPU. Open this widget's config and pick one —
          the rest of the widget works without it.
        </Hint>
      );
    }
    const sorted = [...(vessels ?? [])].sort((a, b) => a.distance - b.distance);
    return (
      <VesselsTab>
        <VesselsHeader>
          <GhostButton
            type="button"
            onClick={refreshVessels}
            disabled={kosRunning || kosDisabled}
          >
            {kosRunning ? "Refreshing…" : "Refresh"}
          </GhostButton>
          {kosLastGoodAt !== null && (
            <VesselsMeta>
              {sorted.length} target{sorted.length === 1 ? "" : "s"} · updated{" "}
              {formatAge(Date.now() - kosLastGoodAt)} ago
            </VesselsMeta>
          )}
        </VesselsHeader>
        {(kosError || kosParseError) && !kosDisabled && (
          <ErrorBanner>
            {(kosError ?? kosParseError)?.message ?? "kOS dispatch failed"}
          </ErrorBanner>
        )}
        {kosDisabled && kosDisabledReason && (
          <ErrorBanner>{kosDisabledReason}</ErrorBanner>
        )}
        {vessels === null && !kosRunning ? (
          <Hint>Press Refresh to enumerate targets via kOS.</Hint>
        ) : sorted.length === 0 ? (
          <Hint>No targets in range.</Hint>
        ) : (
          <BodyList>
            {sorted.map((v) => (
              <BodyRow
                key={v.name}
                type="button"
                $depth={0}
                $current={v.name === tarName}
                onClick={() => targetVessel(v.name)}
              >
                <VesselName>
                  <span>{v.name}</span>
                  <VesselType>{v.type}</VesselType>
                </VesselName>
                <VesselDistance>{formatDistance(v.distance)}</VesselDistance>
                {v.name === tarName && <BodyTag>TARGET</BodyTag>}
              </BodyRow>
            ))}
          </BodyList>
        )}
      </VesselsTab>
    );
  })();

  const currentContent = (
    <CurrentTab>
      {tarName === undefined ? (
        <Hint>No target set in KSP.</Hint>
      ) : (
        <>
          <CurrentRow>
            <CurrentLabel>Name</CurrentLabel>
            <CurrentValue>{tarName}</CurrentValue>
          </CurrentRow>
          {tarType && (
            <CurrentRow>
              <CurrentLabel>Type</CurrentLabel>
              <CurrentValue>{tarType}</CurrentValue>
            </CurrentRow>
          )}
          {typeof tarDistance === "number" && Number.isFinite(tarDistance) && (
            <CurrentRow>
              <CurrentLabel>Distance</CurrentLabel>
              <CurrentValue>{formatDistance(tarDistance)}</CurrentValue>
            </CurrentRow>
          )}
          {typeof tarRelVel === "number" && Number.isFinite(tarRelVel) && (
            <CurrentRow>
              <CurrentLabel>Δv</CurrentLabel>
              <CurrentValue>{tarRelVel.toFixed(2)} m/s</CurrentValue>
            </CurrentRow>
          )}
          <ClearButtonRow>
            <Button onClick={clearTarget} type="button">
              Clear target
            </Button>
          </ClearButtonRow>
        </>
      )}
    </CurrentTab>
  );

  // Selective rendering — at very small sizes the tabbed picker doesn't
  // have room, so collapse to a current-target readout (clear button if
  // there's any width).
  const cols = w ?? 6;
  const rows = h ?? 11;
  const showTabs = rows >= 6 && cols >= 4;

  if (!showTabs) {
    return (
      <Panel>
        <PanelTitle>TARGET</PanelTitle>
        <CompactCurrent>
          {tarName ? (
            <>
              <CompactName>{tarName}</CompactName>
              {typeof tarDistance === "number" &&
                Number.isFinite(tarDistance) && (
                  <CompactDistance>
                    {formatDistance(tarDistance)}
                  </CompactDistance>
                )}
            </>
          ) : (
            <Hint>No target set</Hint>
          )}
        </CompactCurrent>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle>TARGET PICKER</PanelTitle>
      <Tabs
        tabs={[
          { id: "bodies", label: "Bodies", content: bodiesContent },
          { id: "vessels", label: "Vessels", content: vesselsContent },
          { id: "current", label: "Current", content: currentContent },
        ]}
        activeId={tab}
        onChange={(id) => setTab(id as TabId)}
      />
    </Panel>
  );
}

interface BodyTreeNodeProps {
  body: ReturnType<typeof useCelestialBodies>[number];
  childrenOf: Map<string, ReturnType<typeof useCelestialBodies>>;
  depth: number;
  currentTargetName: string | undefined;
  onTarget: (index: number) => void;
}

function BodyTreeNode({
  body,
  childrenOf,
  depth,
  currentTargetName,
  onTarget,
}: BodyTreeNodeProps) {
  const children = body.name ? (childrenOf.get(body.name) ?? []) : [];
  const isCurrent = body.name && body.name === currentTargetName;
  return (
    <>
      <BodyRow
        type="button"
        $depth={depth}
        $current={!!isCurrent}
        onClick={() => onTarget(body.index)}
      >
        <BodyName>{body.name ?? "(unnamed)"}</BodyName>
        {isCurrent && <BodyTag>TARGET</BodyTag>}
      </BodyRow>
      {children.map((child) => (
        <BodyTreeNode
          key={child.index}
          body={child}
          childrenOf={childrenOf}
          depth={depth + 1}
          currentTargetName={currentTargetName}
          onTarget={onTarget}
        />
      ))}
    </>
  );
}

// ── Config component ──────────────────────────────────────────────────────────

function TargetPickerConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<TargetPickerConfig>>) {
  const [cpu, setCpu] = useState(config?.cpu ?? "");
  const [scriptName, setScriptName] = useState(
    config?.scriptName ?? VESSEL_LIST_SCRIPT_NAME,
  );

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="target-picker-cpu">
          kOS CPU (Vessels tab)
        </FieldLabel>
        <KosCpuPicker id="target-picker-cpu" value={cpu} onChange={setCpu} />
        <FieldHint>
          Optional. Without a CPU, the Vessels tab shows a configure-kOS hint.
          Bodies and Current tabs work either way.
        </FieldHint>
      </Field>
      <Field>
        <FieldLabel htmlFor="target-picker-script">Script name</FieldLabel>
        <Input
          id="target-picker-script"
          type="text"
          value={scriptName}
          onChange={(e) => setScriptName(e.target.value)}
        />
        <FieldHint>
          Path on the kOS Archive volume. The widget auto-deploys the bundled
          script there — usually no need to change.
        </FieldHint>
      </Field>
      <PrimaryButton onClick={() => onSave({ cpu, scriptName })}>
        Save
      </PrimaryButton>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const BodiesTab = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  flex: 1;
  min-height: 0;
`;

const FilterInput = styled.input`
  font-size: 12px;
  padding: 4px 6px;
  background: var(--color-surface-app);
  border: 1px solid var(--color-surface-raised);
  border-radius: 2px;
  color: var(--color-text-primary);
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const BodyList = styled(ScrollArea)`
  flex: 1;
  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
`;

const BodyRow = styled.button<{ $depth: number; $current: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px;
  padding-left: ${({ $depth }) => 6 + $depth * 14}px;
  background: ${({ $current }) =>
    $current ? "var(--color-status-go-bg)" : "transparent"};
  color: ${({ $current }) =>
    $current ? "var(--color-status-go-fg)" : "var(--color-text-primary)"};
  border: none;
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  &:hover {
    background: var(--color-surface-panel);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }
`;

const BodyName = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const BodyTag = styled.span`
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--color-status-go-fg);
`;

const Hint = styled.div`
  margin-top: 6px;
  font-size: 11px;
  color: var(--color-text-faint);
  line-height: 1.4;
`;

const CompactCurrent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-align: center;
`;

const CompactName = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: 0.04em;
`;

const CompactDistance = styled.div`
  font-size: 11px;
  color: var(--color-accent-fg);
  letter-spacing: 0.04em;
`;

const CurrentTab = styled.div`
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const CurrentRow = styled.div`
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 6px;
  font-size: 12px;
`;

const CurrentLabel = styled.span`
  color: var(--color-text-faint);
  letter-spacing: 0.05em;
  font-size: 10px;
  text-transform: uppercase;
  align-self: center;
`;

const CurrentValue = styled.span`
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
`;

const ClearButtonRow = styled.div`
  margin-top: 8px;
`;

const VesselsTab = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  flex: 1;
  min-height: 0;
`;

const VesselsHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const VesselsMeta = styled.span`
  font-size: 10px;
  color: var(--color-text-faint);
  letter-spacing: 0.04em;
`;

const ErrorBanner = styled.div`
  font-size: 10px;
  color: var(--color-status-warning-bg);
  padding: 4px 6px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-status-warning-bg);
  border-radius: 2px;
`;

const VesselName = styled.span`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const VesselType = styled.span`
  font-size: 9px;
  color: var(--color-text-faint);
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const VesselDistance = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  margin-right: 6px;
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<TargetPickerConfig>({
  id: "target-picker",
  name: "Target Picker",
  description:
    "Pick a target body, vessel, or inspect the current target. Bodies tab lists every body Telemachus reports grouped by reference-body. Vessels tab uses a kOS managed script to enumerate in-range targets (sorted by distance) and click-to-target by name. Current tab shows the active target's name / type / distance / Δv with a clear button.",
  tags: ["telemetry", "navigation", "kos"],
  defaultSize: { w: 6, h: 11 },
  minSize: { w: 3, h: 3 },
  component: TargetPickerComponent,
  configComponent: TargetPickerConfigComponent,
  dataRequirements: [
    "b.number",
    "tar.name",
    "tar.type",
    "tar.distance",
    "tar.o.relativeVelocity",
  ],
  defaultConfig: { cpu: "", scriptName: VESSEL_LIST_SCRIPT_NAME },
  actions: targetPickerActions,
  pushable: true,
});

export { TargetPickerComponent };
