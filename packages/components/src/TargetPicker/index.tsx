import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@gonogo/core";
import {
  formatAge,
  formatDistance,
  getDataSource,
  registerComponent,
  useActionInput,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import { hashKosScript, isScriptable, useKosScriptStatus } from "@gonogo/data";
import {
  Button,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Panel,
  PanelTitle,
  PrimaryButton,
  ScrollArea,
  Tabs,
} from "@gonogo/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { useCelestialBodies } from "../SystemView/useCelestialBodies";
import { SET_TARGET_SCRIPT, SET_TARGET_SCRIPT_NAME } from "./setTargetScript";
import {
  TARGET_VESSELS_TOPIC_ID,
  type VesselListEntry,
} from "./vesselListScript";

const VESSELS_KEY = `kos.compute.${TARGET_VESSELS_TOPIC_ID}.vessels`;
const DISPATCH_NOW_ACTION = `kos.compute.${TARGET_VESSELS_TOPIC_ID}.dispatchNow`;
const SET_TARGET_SCRIPT_VERSION = hashKosScript(SET_TARGET_SCRIPT);

// Config is empty post-migration — the per-widget CPU / scriptName moved
// to the centralised kOS data source.
type TargetPickerConfig = Record<string, never>;
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
  w,
  h,
}: Readonly<ComponentProps<TargetPickerConfig>>) {
  const bodies = useCelestialBodies();
  const tarName = useDataValue("data", "tar.name") as string | undefined;
  const tarType = useDataValue("data", "tar.type") as string | undefined;
  const tarDistance = useDataValue("data", "tar.distance");
  const tarRelVel = useDataValue("data", "tar.o.relativeVelocity");
  const execute = useExecuteAction("data");
  const executeKos = useExecuteAction("kos");

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

  // ── Centralised vessel listing ───────────────────────────────────────────
  // The Vessels tab subscribes to the `target-vessels` feed. One loop runs
  // on the active CPU regardless of how many TargetPickers are open; the
  // active CPU lives on the kOS data source config now (no per-widget CPU
  // picker).
  const vessels = useDataValue<VesselListEntry[]>("kos", VESSELS_KEY);
  const status = useKosScriptStatus(TARGET_VESSELS_TOPIC_ID);

  const refreshVessels = useCallback(() => {
    void executeKos(DISPATCH_NOW_ACTION);
  }, [executeKos]);

  // "✓ Updated" flash on each successful refresh — the Refreshing→Refresh
  // button transition is too brief to read on a fast script and leaves the
  // operator wondering whether anything happened. Tracks lastGoodAt's
  // identity, sets a 2 s flash whenever it advances.
  const lastGoodAt = status.lastGoodAt;
  const prevLastGoodAtRef = useRef<number | null>(null);
  const [flashConfirm, setFlashConfirm] = useState(false);
  useEffect(() => {
    if (lastGoodAt === null) return;
    if (prevLastGoodAtRef.current === null) {
      prevLastGoodAtRef.current = lastGoodAt;
      return;
    }
    if (lastGoodAt > prevLastGoodAtRef.current) {
      prevLastGoodAtRef.current = lastGoodAt;
      setFlashConfirm(true);
      const id = setTimeout(() => setFlashConfirm(false), 2000);
      return () => clearTimeout(id);
    }
  }, [lastGoodAt]);

  // Set-target is a one-shot RPC — kept off the centralised feed because
  // it takes a per-call name argument. After the script resolves we kick
  // the central feed for a fresh sample so the new TARGET row updates.
  const targetVessel = useCallback(
    (name: string) => {
      const source = getDataSource("kos");
      if (!isScriptable(source)) return;
      void source
        .executeScript(
          // The compute fanout owns the active CPU; we have to peek at its
          // config to dispatch. Empty string short-circuits in the source.
          (source.getConfig() as { activeCpu?: string }).activeCpu ?? "",
          SET_TARGET_SCRIPT_NAME,
          [name],
          { body: SET_TARGET_SCRIPT, version: SET_TARGET_SCRIPT_VERSION },
        )
        .then(() => executeKos(DISPATCH_NOW_ACTION))
        .catch(() => {
          /* errors surface on next feed cycle */
        });
    },
    [executeKos],
  );

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
    const sorted = [...(vessels ?? [])].sort((a, b) => a.distance - b.distance);
    const error =
      status.scriptError && !status.paused
        ? status.scriptError
        : status.parseError;
    return (
      <VesselsTab>
        <VesselsHeader>
          <GhostButton
            type="button"
            onClick={refreshVessels}
            disabled={status.running || status.paused}
          >
            {status.running ? "Refreshing…" : "Refresh"}
          </GhostButton>
          {status.lastGoodAt !== null && (
            <VesselsMeta $flash={flashConfirm} role="status" aria-live="polite">
              {flashConfirm ? "✓ " : ""}
              {sorted.length} target{sorted.length === 1 ? "" : "s"} ·{" "}
              {flashConfirm
                ? "updated just now"
                : `updated ${formatAge(Date.now() - status.lastGoodAt)} ago`}
            </VesselsMeta>
          )}
        </VesselsHeader>
        {error && <ErrorBanner>{error.message}</ErrorBanner>}
        {status.paused && status.scriptError && (
          <ErrorBanner>{status.scriptError.message}</ErrorBanner>
        )}
        {vessels === null && !status.running ? (
          <Hint>Waiting for kOS feed…</Hint>
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
  onSave,
}: Readonly<ConfigComponentProps<TargetPickerConfig>>) {
  return (
    <ConfigForm>
      <Field>
        <FieldLabel>Active kOS CPU (Vessels tab)</FieldLabel>
        <FieldHint>
          The Vessels tab subscribes to the centralised kOS feed. Set the active
          CPU on the kOS data source — it applies to every centralised kOS
          widget. Bodies and Current tabs work without a CPU configured.
        </FieldHint>
      </Field>
      <PrimaryButton onClick={() => onSave({})}>Save</PrimaryButton>
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

const VesselsMeta = styled.span<{ $flash: boolean }>`
  font-size: 10px;
  color: ${({ $flash }) =>
    $flash ? "var(--color-status-go-fg)" : "var(--color-text-faint)"};
  letter-spacing: 0.04em;
  transition: color 200ms ease-out;
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
    VESSELS_KEY,
    "b.number",
    "tar.name",
    "tar.type",
    "tar.distance",
    "tar.o.relativeVelocity",
  ],
  defaultConfig: {},
  actions: targetPickerActions,
  pushable: true,
});

export { TargetPickerComponent };
