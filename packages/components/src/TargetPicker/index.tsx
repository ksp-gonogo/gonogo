import type { ActionDefinition, ComponentProps } from "@gonogo/core";
import {
  formatDistance,
  registerComponent,
  useActionInput,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import { Button, Panel, PanelTitle, Tabs } from "@gonogo/ui";
import { useMemo, useState } from "react";
import styled from "styled-components";
import { useCelestialBodies } from "../SystemView/useCelestialBodies";

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

function TargetPickerComponent(
  _: Readonly<ComponentProps<TargetPickerConfig>>,
) {
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

  const vesselsContent = (
    <Hint>
      Vessels-by-name targeting needs a kOS-backed enumeration script —
      Telemachus has no list endpoint. Coming in a follow-up.
    </Hint>
  );

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

const BodyList = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
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

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<TargetPickerConfig>({
  id: "target-picker",
  name: "Target Picker",
  description:
    "Pick a target body or inspect the current target. The Bodies tab lists every body Telemachus reports (b.name[i]) grouped by reference-body, click to fire tar.setTargetBody. Current tab shows name / type / distance / relative velocity with a clear button. Vessel targeting needs a kOS list endpoint — not in v1.",
  tags: ["telemetry", "navigation"],
  defaultSize: { w: 6, h: 11 },
  component: TargetPickerComponent,
  dataRequirements: [
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
