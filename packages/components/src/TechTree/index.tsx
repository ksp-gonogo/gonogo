import type { ComponentProps } from "@gonogo/core";
import {
  getSizeBucket,
  registerComponent,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle, ScrollArea } from "@gonogo/ui";
import { useEffect, useState } from "react";
import styled from "styled-components";

type TechTreeConfig = Record<string, never>;

export type TechNodeState = "Available" | "Researchable" | "Unavailable";

export interface TechPart {
  name: string;
  title: string;
  manufacturer: string;
  category: string;
  entryCost: number;
  purchased: boolean;
}

export interface TechNode {
  id: string;
  title: string;
  description: string;
  scienceCost: number;
  state: TechNodeState;
  parents: string[];
  parts: TechPart[];
}

/**
 * Defensive parser for `tech.nodes` from the GonogoTelemetry plugin.
 * Drops malformed entries; tolerates missing optional fields (description,
 * parts) so older Telemachus DLLs degrade gracefully — the operator still
 * sees title + scienceCost + state + parents even without the 2026-05-13
 * fork additions.
 */
export function parseTechNodes(raw: unknown): TechNode[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: TechNode[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : null;
    if (!id) continue;
    const stateRaw = typeof e.state === "string" ? e.state : "Unavailable";
    const state: TechNodeState =
      stateRaw === "Available" || stateRaw === "Researchable"
        ? stateRaw
        : "Unavailable";
    out.push({
      id,
      title: typeof e.title === "string" ? e.title : id,
      description: typeof e.description === "string" ? e.description : "",
      scienceCost: typeof e.scienceCost === "number" ? e.scienceCost : 0,
      state,
      parents: Array.isArray(e.parents)
        ? e.parents.filter((p): p is string => typeof p === "string")
        : [],
      parts: Array.isArray(e.parts)
        ? e.parts.map(parsePart).filter(notNull)
        : [],
    });
  }
  return out;
}

function parsePart(raw: unknown): TechPart | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name : null;
  if (!name) return null;
  return {
    name,
    title: typeof p.title === "string" ? p.title : name,
    manufacturer: typeof p.manufacturer === "string" ? p.manufacturer : "",
    category: typeof p.category === "string" ? p.category : "",
    entryCost: typeof p.entryCost === "number" ? p.entryCost : 0,
    purchased: p.purchased === true,
  };
}

function notNull<T>(x: T | null): x is T {
  return x !== null;
}

const ARM_TIMEOUT_MS = 4000;

// ── Component ─────────────────────────────────────────────────────────────

function TechTreeComponent({ w, h }: Readonly<ComponentProps<TechTreeConfig>>) {
  const nodesRaw = useDataValue("data", "tech.nodes");
  const scene = useDataValue<string>("data", "kc.scene");
  const careerScience = useDataValue<number>("data", "career.science");
  const execute = useExecuteAction("data");

  const allNodes = parseTechNodes(nodesRaw);

  const [filter, setFilter] = useState<"researchable" | "all" | "unlocked">(
    "researchable",
  );
  const [query, setQuery] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const [pendingUnlock, setPendingUnlock] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Drop the arm after the user-facing timeout so a half-committed Unlock
  // doesn't sit there indefinitely.
  useEffect(() => {
    if (armed === null) return;
    const id = setTimeout(() => setArmed(null), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);

  // Clear pending-unlock once the optimistic state appears in tech.nodes
  // (the node flips to Available) or after a 5s safety timeout.
  useEffect(() => {
    if (pendingUnlock === null) return;
    const target = allNodes?.find((n) => n.id === pendingUnlock);
    if (target?.state === "Available") {
      setPendingUnlock(null);
      return;
    }
    const id = setTimeout(() => setPendingUnlock(null), 5_000);
    return () => clearTimeout(id);
  }, [pendingUnlock, allNodes]);

  const bucket = getSizeBucket(w, h);
  const rows = h ?? 8;
  const showSubtitle = rows >= 4;
  const sciAvailable = typeof careerScience === "number" ? careerScience : null;

  // ── Loading / empty states ────────────────────────────────────────────
  if (allNodes === null) {
    return (
      <Panel>
        <PanelTitle>TECH TREE</PanelTitle>
        {showSubtitle && <PanelSubtitle>Awaiting tech telemetry</PanelSubtitle>}
      </Panel>
    );
  }
  if (allNodes.length === 0) {
    return (
      <Panel>
        <PanelTitle>TECH TREE</PanelTitle>
        {showSubtitle && <PanelSubtitle>No tech nodes loaded</PanelSubtitle>}
      </Panel>
    );
  }

  // ── Counts (drive tiny mode + subtitle) ───────────────────────────────
  const counts = {
    unlocked: 0,
    researchable: 0,
    unavailable: 0,
  };
  for (const n of allNodes) {
    if (n.state === "Available") counts.unlocked++;
    else if (n.state === "Researchable") counts.researchable++;
    else counts.unavailable++;
  }

  // ── Tiny mode — single-glance summary ─────────────────────────────────
  if (bucket === "tiny") {
    return (
      <Panel>
        <PanelTitle>TECH</PanelTitle>
        <TinyBody>
          <TinyCount>
            {counts.researchable}
            <TinyLabel>RESEARCHABLE</TinyLabel>
          </TinyCount>
          {sciAvailable !== null && (
            <TinySci>{Math.round(sciAvailable)} sci</TinySci>
          )}
        </TinyBody>
      </Panel>
    );
  }

  // ── Filtering ─────────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const filtered = allNodes
    .filter((n) => {
      if (filter === "researchable") return n.state === "Researchable";
      if (filter === "unlocked") return n.state === "Available";
      return true;
    })
    .filter((n) => {
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.id.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q)
      );
    });

  const sorted = sortNodes(filtered);

  return (
    <Panel>
      <PanelTitle>TECH TREE</PanelTitle>
      {showSubtitle && (
        <PanelSubtitle role="status" aria-live="polite">
          {counts.unlocked}/{allNodes.length} unlocked · {counts.researchable}{" "}
          researchable
          {sciAvailable !== null && (
            <SciReadout title="Available science">
              · {Math.round(sciAvailable)} sci
            </SciReadout>
          )}
        </PanelSubtitle>
      )}
      <Controls>
        <FilterRow role="group" aria-label="Filter tech nodes">
          <FilterBtn
            type="button"
            $active={filter === "researchable"}
            onClick={() => setFilter("researchable")}
          >
            Researchable
          </FilterBtn>
          <FilterBtn
            type="button"
            $active={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All
          </FilterBtn>
          <FilterBtn
            type="button"
            $active={filter === "unlocked"}
            onClick={() => setFilter("unlocked")}
          >
            Unlocked
          </FilterBtn>
        </FilterRow>
        <SearchInput
          type="search"
          placeholder="Filter by name or description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter tech nodes by text"
        />
      </Controls>
      <Body>
        <NodeList>
          {sorted.length === 0 ? (
            <Empty>No nodes match</Empty>
          ) : (
            sorted.map((n) => {
              const isExpanded = expandedId === n.id;
              const canAfford =
                sciAvailable === null || sciAvailable >= n.scienceCost;
              const isUnlockable = n.state === "Researchable";
              const upgradesEnabled =
                scene === undefined || scene === "SpaceCenter";
              const canUnlock = isUnlockable && canAfford && upgradesEnabled;
              const isPending = pendingUnlock === n.id;
              return (
                <NodeRow
                  key={n.id}
                  node={n}
                  expanded={isExpanded}
                  onToggleExpand={() =>
                    setExpandedId((current) => (current === n.id ? null : n.id))
                  }
                  armed={armed === n.id}
                  onArm={() => setArmed(n.id)}
                  onConfirm={() => {
                    setArmed(null);
                    setPendingUnlock(n.id);
                    void execute(`tech.unlock[${n.id}]`);
                  }}
                  canUnlock={canUnlock}
                  isPending={isPending}
                  affordTooltip={
                    !canAfford
                      ? `Need ${n.scienceCost} sci (have ${sciAvailable})`
                      : !upgradesEnabled
                        ? "Unlock from the Space Center scene"
                        : undefined
                  }
                />
              );
            })
          )}
        </NodeList>
      </Body>
    </Panel>
  );
}

// Sort: Researchable first, then by science cost ascending, then alphabetically.
// Within a tier the cheapest gives the operator a clear next-purchase.
function sortNodes(nodes: TechNode[]): TechNode[] {
  const STATE_RANK: Record<TechNodeState, number> = {
    Researchable: 0,
    Available: 1,
    Unavailable: 2,
  };
  return [...nodes].sort((a, b) => {
    if (a.state !== b.state) return STATE_RANK[a.state] - STATE_RANK[b.state];
    if (a.scienceCost !== b.scienceCost) return a.scienceCost - b.scienceCost;
    return a.title.localeCompare(b.title);
  });
}

interface NodeRowProps {
  node: TechNode;
  expanded: boolean;
  onToggleExpand: () => void;
  armed: boolean;
  onArm: () => void;
  onConfirm: () => void;
  canUnlock: boolean;
  isPending: boolean;
  affordTooltip?: string;
}

function NodeRow({
  node,
  expanded,
  onToggleExpand,
  armed,
  onArm,
  onConfirm,
  canUnlock,
  isPending,
  affordTooltip,
}: Readonly<NodeRowProps>) {
  const stateBadgeTone =
    node.state === "Available"
      ? "go"
      : node.state === "Researchable"
        ? "accent"
        : "muted";

  return (
    <NodeRowWrap $state={node.state}>
      <NodeHeader
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
      >
        <NodeTitle>
          {node.title}
          <NodeId>({node.id})</NodeId>
        </NodeTitle>
        <NodeMeta>
          {node.state !== "Available" && <Cost>{node.scienceCost} sci</Cost>}
          <StateBadge $tone={stateBadgeTone}>{node.state}</StateBadge>
        </NodeMeta>
      </NodeHeader>
      {expanded && (
        <NodeBody>
          {node.description && <Description>{node.description}</Description>}
          {node.parents.length > 0 && (
            <Parents>
              <ParentsLabel>Requires</ParentsLabel>
              <ParentsList>
                {node.parents.map((p) => (
                  <ParentChip key={p}>{p}</ParentChip>
                ))}
              </ParentsList>
            </Parents>
          )}
          {node.parts.length > 0 && (
            <Parts>
              <PartsLabel>Parts ({node.parts.length})</PartsLabel>
              <PartsList>
                {node.parts.map((p) => (
                  <PartRow key={p.name} $purchased={p.purchased}>
                    <PartTitle title={p.manufacturer || undefined}>
                      {p.title}
                    </PartTitle>
                    <PartMeta>
                      {p.category && <PartCategory>{p.category}</PartCategory>}
                      {p.entryCost > 0 && !p.purchased && (
                        <PartCost>{p.entryCost.toLocaleString()}f</PartCost>
                      )}
                      {p.purchased && <PartPurchased>✓</PartPurchased>}
                    </PartMeta>
                  </PartRow>
                ))}
              </PartsList>
            </Parts>
          )}
          {node.state === "Researchable" && (
            <UnlockRow>
              {isPending ? (
                <PendingBtn type="button" disabled aria-busy="true">
                  Unlocking…
                </PendingBtn>
              ) : armed ? (
                <ConfirmBtn type="button" onClick={onConfirm}>
                  Confirm unlock — {node.scienceCost} sci
                </ConfirmBtn>
              ) : (
                <ArmBtn
                  type="button"
                  onClick={onArm}
                  disabled={!canUnlock}
                  title={affordTooltip}
                >
                  Unlock
                </ArmBtn>
              )}
            </UnlockRow>
          )}
        </NodeBody>
      )}
    </NodeRowWrap>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const Controls = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 6px;
  flex-shrink: 0;
`;

const FilterRow = styled.div`
  display: inline-flex;
  gap: 4px;
`;

const FilterBtn = styled.button<{ $active: boolean }>`
  font-size: 10px;
  letter-spacing: 0.06em;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid
    ${(p) => (p.$active ? "var(--color-accent-fg)" : "var(--color-surface-raised)")};
  background: ${(p) =>
    p.$active ? "var(--color-status-go-bg)" : "transparent"};
  color: ${(p) =>
    p.$active ? "var(--color-status-go-fg)" : "var(--color-text-muted)"};
  cursor: pointer;
  font-family: inherit;

  &:hover {
    color: var(--color-text-primary);
  }
`;

const SearchInput = styled.input`
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-primary);
  font: inherit;
  padding: 4px 6px;
  border-radius: 2px;
  outline: none;

  &:focus {
    border-color: var(--color-accent-fg);
  }
`;

const Body = styled(ScrollArea)`
  flex: 1;
  min-height: 0;

  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
`;

const NodeList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const NodeRowWrap = styled.li<{ $state: TechNodeState }>`
  display: flex;
  flex-direction: column;
  background: var(--color-surface-panel);
  border-left: 2px solid
    ${(p) =>
      p.$state === "Available"
        ? "var(--color-status-go-fg)"
        : p.$state === "Researchable"
          ? "var(--color-accent-fg)"
          : "var(--color-text-faint)"};
  border-radius: 2px;
  opacity: ${(p) => (p.$state === "Unavailable" ? 0.65 : 1)};
`;

const NodeHeader = styled.button`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: inherit;
  text-align: left;

  &:hover {
    background: var(--color-surface-raised);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }
`;

const NodeTitle = styled.span`
  font-size: 12px;
  color: var(--color-text-primary);
  font-weight: 600;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const NodeId = styled.span`
  font-size: 10px;
  font-family: monospace;
  color: var(--color-text-faint);
  font-weight: 400;
`;

const NodeMeta = styled.span`
  display: inline-flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
`;

const Cost = styled.span`
  font-size: 11px;
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

const StateBadge = styled.span<{ $tone: "go" | "accent" | "muted" }>`
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 2px;
  color: ${(p) =>
    p.$tone === "go"
      ? "var(--color-status-go-fg)"
      : p.$tone === "accent"
        ? "var(--color-accent-fg)"
        : "var(--color-text-faint)"};
  background: ${(p) =>
    p.$tone === "go"
      ? "var(--color-status-go-bg)"
      : p.$tone === "accent"
        ? "transparent"
        : "transparent"};
`;

const NodeBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 10px 8px;
  border-top: 1px dashed var(--color-surface-raised);
`;

const Description = styled.div`
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1.4;
  font-style: italic;
`;

const Parents = styled.div`
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
`;

const ParentsLabel = styled.span`
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const ParentsList = styled.span`
  display: inline-flex;
  gap: 4px;
  flex-wrap: wrap;
`;

const ParentChip = styled.span`
  font-size: 10px;
  font-family: monospace;
  color: var(--color-text-muted);
  padding: 1px 6px;
  background: var(--color-surface-sunken);
  border-radius: 2px;
`;

const Parts = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const PartsLabel = styled.span`
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const PartsList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const PartRow = styled.li<{ $purchased: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  padding: 1px 0;
  opacity: ${(p) => (p.$purchased ? 0.7 : 1)};
`;

const PartTitle = styled.span`
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
`;

const PartMeta = styled.span`
  display: inline-flex;
  gap: 6px;
  align-items: baseline;
  flex-shrink: 0;
`;

const PartCategory = styled.span`
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const PartCost = styled.span`
  font-size: 10px;
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

const PartPurchased = styled.span`
  font-size: 10px;
  color: var(--color-status-go-fg);
`;

const UnlockRow = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const armButtonBase = `
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 4px 12px;
  border-radius: 2px;
  cursor: pointer;
  font-family: inherit;
  border: 1px solid var(--color-surface-raised);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: center;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
`;

const ArmBtn = styled.button`
  ${armButtonBase}
  background: var(--color-status-go-bg);
  color: var(--color-status-go-fg);
  border-color: transparent;

  &:hover:not(:disabled) {
    filter: brightness(1.1);
  }
`;

const ConfirmBtn = styled.button`
  ${armButtonBase}
  background: var(--color-status-go-bg);
  color: var(--color-status-go-fg);
  border-color: transparent;
  animation: techPulse 1s ease-in-out infinite;

  @media (prefers-reduced-motion: no-preference) {
    @keyframes techPulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.6;
      }
    }
  }
`;

const PendingBtn = styled.button`
  ${armButtonBase}
  background: var(--color-surface-raised);
  color: var(--color-text-muted);
  border-color: transparent;
`;

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: 11px;
  padding: 12px;
  text-align: center;
`;

const SciReadout = styled.span`
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
  margin-left: 2px;
`;

// ── Tiny mode ──────────────────────────────────────────────────────────────

const TinyBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px;
`;

const TinyCount = styled.div`
  font-size: 24px;
  font-weight: 600;
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
`;

const TinyLabel = styled.span`
  font-size: 8px;
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
  margin-top: 2px;
`;

const TinySci = styled.span`
  font-size: 10px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
`;

// ── Registration ──────────────────────────────────────────────────────────

registerComponent<TechTreeConfig>({
  id: "tech-tree",
  name: "Tech Tree",
  description:
    "Browse and unlock career-mode tech nodes. Filterable by state (researchable / unlocked / all), searchable by name or description, with the full part list each node unlocks visible on click.",
  tags: ["career", "tech"],
  defaultSize: { w: 6, h: 9 },
  minSize: { w: 2, h: 2 },
  component: TechTreeComponent,
  dataRequirements: ["tech.nodes", "career.science", "kc.scene"],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["career"],
});

export { TechTreeComponent };
