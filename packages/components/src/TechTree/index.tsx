import type { ComponentProps } from "@gonogo/core";
import {
  getSizeBucket,
  registerComponent,
  useDataStreamStatus,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import {
  Panel,
  PanelSubtitle,
  PanelTitle,
  ScrollArea,
  StreamStatusBadge,
} from "@gonogo/ui";
import { useEffect, useMemo, useState } from "react";
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
 * Defensive parser for tech-node array payloads. Accepts BOTH the legacy
 * GonogoTelemetry `tech.nodes` shape (an explicit `state: "Available" |
 * "Researchable" | "Unavailable"` string) and the M3b career-detail wire
 * shape (`career.status.tech.nodes`, CareerViewProvider.BuildTechNodes:
 * `unlocked: boolean`, no `state` at all — the server deliberately doesn't
 * compute the 3-state "Researchable" distinction, career-capture-extend-
 * report.md). When `state` is absent, derive it from `unlocked`
 * (`true` -> "Available", `false` -> "Unavailable") — `computeResearchable`
 * below already promotes some "Unavailable" nodes to researchable-now purely
 * from `state`/`parents`/`scienceCost`, exactly the client-side derivation
 * the extend session's doc comment anticipated. `description`/`parts` stay
 * empty on the new wire (no equivalent field) — both already default
 * gracefully. Drops malformed entries; tolerates missing optional fields
 * (description, parts) so older Telemachus DLLs degrade gracefully — the
 * operator still sees title + scienceCost + state + parents even without
 * the 2026-05-13 fork additions.
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
    const stateRaw =
      typeof e.state === "string"
        ? e.state
        : e.unlocked === true
          ? "Available"
          : "Unavailable";
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

// Switch to the tiered dependency graph only once the widget is wide enough
// for columns + connectors to be legible. The KSP R&D tree is inherently
// landscape; below this we keep the compact list. `mobile-9x8` (w=9) and the
// `default-6x9` view both stay on the list. Undefined dims (e.g. the unit-test
// render path, before the grid measures) also fall through to the list, which
// keeps the behavioural tests exercising the unchanged list UI.
const GRAPH_MIN_COLS = 10;

// ── Researchable derivation ─────────────────────────────────────────────────

/**
 * A node is *researchable-now* when it is not yet owned, every parent is
 * already unlocked, and its science cost is affordable. The plugin only emits
 * `Available` / `Unavailable`, so this status is computed here rather than read
 * off `state` (the old default filter matched a `state === "Researchable"`
 * that real saves never produce — hence the empty first paint). Test fixtures
 * that set an explicit `"Researchable"` state are also honoured.
 */
function computeResearchable(
  nodes: TechNode[],
  science: number | null,
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.state === "Available") continue;
    if (n.state === "Researchable") {
      // Explicit state from a fixture / older payload — trust it.
      out.add(n.id);
      continue;
    }
    const parentsUnlocked = n.parents.every(
      (p) => byId.get(p)?.state === "Available",
    );
    if (!parentsUnlocked) continue;
    if (science !== null && n.scienceCost > science) continue;
    out.add(n.id);
  }
  return out;
}

/**
 * Longest-path depth from a root (a parentless node is tier 0). Variable-span
 * edges are fine — a tier-5 node may have a tier-0 parent. Cycle-guarded.
 */
function computeTiers(nodes: TechNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  function tier(id: string): number {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const n = byId.get(id);
    if (!n || n.parents.length === 0) {
      memo.set(id, 0);
      return 0;
    }
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    let t = 0;
    for (const p of n.parents) {
      if (byId.has(p)) t = Math.max(t, tier(p) + 1);
    }
    visiting.delete(id);
    memo.set(id, t);
    return t;
  }
  for (const n of nodes) tier(n.id);
  return memo;
}

type DisplayState = "owned" | "researchable" | "locked";

function displayState(node: TechNode, researchable: Set<string>): DisplayState {
  if (node.state === "Available") return "owned";
  if (researchable.has(node.id)) return "researchable";
  return "locked";
}

// ── Graph layout ────────────────────────────────────────────────────────────

interface PlacedNode {
  node: TechNode;
  tier: number;
  row: number; // vertical slot within the column
  x: number;
  y: number;
}

const COL_W = 134; // px between column left edges
const CARD_W = 118;
const CARD_H = 48; // fits a 2-line clamped title + the cost/owned row
const ROW_GAP = 12;
const CANVAS_PAD = 16;

/**
 * Assign each node a (tier, row) slot, then run a single barycenter pass to
 * order rows within a column by the mean row of their parents. This kills the
 * bulk of edge crossings without a full Sugiyama layout.
 */
function layoutGraph(
  nodes: TechNode[],
  tiers: Map<string, number>,
): { placed: PlacedNode[]; width: number; height: number } {
  const maxTier = Math.max(0, ...nodes.map((n) => tiers.get(n.id) ?? 0));
  const columns: TechNode[][] = Array.from({ length: maxTier + 1 }, () => []);
  for (const n of nodes) columns[tiers.get(n.id) ?? 0].push(n);

  // Initial within-column order: by science cost then title (stable, readable).
  for (const col of columns) {
    col.sort(
      (a, b) => a.scienceCost - b.scienceCost || a.title.localeCompare(b.title),
    );
  }

  // Row index per node, seeded from the initial order.
  const rowOf = new Map<string, number>();
  for (const col of columns) {
    col.forEach((n, i) => {
      rowOf.set(n.id, i);
    });
  }

  // Barycenter sweep: order each column (left→right) by mean parent row.
  for (let pass = 0; pass < 4; pass++) {
    for (let t = 1; t < columns.length; t++) {
      const col = columns[t];
      const bary = new Map<string, number>();
      for (const n of col) {
        const parentRows = n.parents
          .map((p) => rowOf.get(p))
          .filter((r): r is number => r !== undefined);
        bary.set(
          n.id,
          parentRows.length
            ? parentRows.reduce((s, r) => s + r, 0) / parentRows.length
            : (rowOf.get(n.id) ?? 0),
        );
      }
      col.sort(
        (a, b) =>
          (bary.get(a.id) ?? 0) - (bary.get(b.id) ?? 0) ||
          a.scienceCost - b.scienceCost,
      );
      col.forEach((n, i) => {
        rowOf.set(n.id, i);
      });
    }
  }

  const placed: PlacedNode[] = [];
  let maxRows = 0;
  for (let t = 0; t < columns.length; t++) {
    maxRows = Math.max(maxRows, columns[t].length);
    columns[t].forEach((n, row) => {
      placed.push({
        node: n,
        tier: t,
        row,
        x: CANVAS_PAD + t * COL_W,
        y: CANVAS_PAD + row * (CARD_H + ROW_GAP),
      });
    });
  }

  const width = CANVAS_PAD * 2 + maxTier * COL_W + CARD_W;
  const height = CANVAS_PAD * 2 + Math.max(1, maxRows) * (CARD_H + ROW_GAP);
  return { placed, width, height };
}

// ── Component ─────────────────────────────────────────────────────────────

function TechTreeComponent({ w, h }: Readonly<ComponentProps<TechTreeConfig>>) {
  // M3 career batch: career.science -> career.status.economy.science.
  // M3b career-detail batch: tech.nodes -> career.status.tech.nodes now
  // MAPPED too — the wire's career.status.tech.nodes carries
  // id/title/scienceCost/unlocked/parents (career-capture-extend-report.md);
  // parseTechNodes derives the Available/Unavailable state from `unlocked`
  // client-side (no server-computed Researchable 3rd state — this widget's
  // own computeResearchable already does that derivation). kc.scene stays
  // legacy (no career.status equivalent). tech.unlock[...] (the spend
  // command) still has no command home (KNOWN_COMMAND_GAPS) and falls back
  // to legacy automatically — this batch migrates the read only.
  const nodesRaw = useDataValue("data", "tech.nodes");
  const scene = useDataValue<string>("data", "kc.scene");
  const careerScience = useDataValue<number>("data", "career.science");
  const streamStatus = useDataStreamStatus("data", "career.science");
  const execute = useExecuteAction("data");

  const allNodes = parseTechNodes(nodesRaw);

  const [filter, setFilter] = useState<"all" | "researchable" | "unlocked">(
    "all",
  );
  const [query, setQuery] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const [pendingUnlock, setPendingUnlock] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const researchable = useMemo(
    () => computeResearchable(allNodes ?? [], sciAvailable),
    [allNodes, sciAvailable],
  );
  const tiers = useMemo(() => computeTiers(allNodes ?? []), [allNodes]);

  // ── Loading / empty states ────────────────────────────────────────────
  if (allNodes === null) {
    return (
      <Panel>
        <TitleRow>
          <PanelTitle>TECH TREE</PanelTitle>
          <StreamStatusBadge status={streamStatus} />
        </TitleRow>
        {showSubtitle && <PanelSubtitle>Awaiting tech telemetry</PanelSubtitle>}
      </Panel>
    );
  }
  if (allNodes.length === 0) {
    return (
      <Panel>
        <TitleRow>
          <PanelTitle>TECH TREE</PanelTitle>
          <StreamStatusBadge status={streamStatus} />
        </TitleRow>
        {showSubtitle && <PanelSubtitle>No tech nodes loaded</PanelSubtitle>}
      </Panel>
    );
  }

  // ── Counts (drive tiny mode + subtitle) ───────────────────────────────
  const counts = { unlocked: 0, researchable: researchable.size };
  for (const n of allNodes) if (n.state === "Available") counts.unlocked++;

  // ── Tiny mode — single-glance summary ─────────────────────────────────
  if (bucket === "tiny") {
    return (
      <Panel>
        <TitleRow>
          <PanelTitle>TECH</PanelTitle>
          <StreamStatusBadge status={streamStatus} />
        </TitleRow>
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

  const upgradesEnabled = scene === undefined || scene === "SpaceCenter";

  const unlockHandlersFor = (n: TechNode) => {
    const isResearchable = researchable.has(n.id);
    const canAfford = sciAvailable === null || sciAvailable >= n.scienceCost;
    const canUnlock = isResearchable && canAfford && upgradesEnabled;
    return {
      isResearchable,
      canAfford,
      canUnlock,
      isPending: pendingUnlock === n.id,
      affordTooltip: !canAfford
        ? `Need ${n.scienceCost} sci (have ${sciAvailable})`
        : !upgradesEnabled
          ? "Unlock from the Space Center scene"
          : undefined,
      onArm: () => setArmed(n.id),
      onConfirm: () => {
        setArmed(null);
        setPendingUnlock(n.id);
        void execute(`tech.unlock[${n.id}]`);
      },
    };
  };

  const subtitle = showSubtitle ? (
    <PanelSubtitle role="status" aria-live="polite">
      {counts.unlocked}/{allNodes.length} unlocked · {counts.researchable}{" "}
      researchable
      {sciAvailable !== null && (
        <SciReadout title="Available science">
          · {Math.round(sciAvailable)} sci
        </SciReadout>
      )}
    </PanelSubtitle>
  ) : null;

  // ── Graph mode — tiered dependency view (wide enough only) ────────────
  const useGraph = w !== undefined && w >= GRAPH_MIN_COLS;
  if (useGraph) {
    const q = query.trim().toLowerCase();
    const matches = (n: TechNode) =>
      !q ||
      n.title.toLowerCase().includes(q) ||
      n.id.toLowerCase().includes(q) ||
      n.description.toLowerCase().includes(q);

    return (
      <Panel>
        <TitleRow>
          <PanelTitle>TECH TREE</PanelTitle>
          <StreamStatusBadge status={streamStatus} />
        </TitleRow>
        {subtitle}
        <GraphToolbar>
          <Legend aria-hidden="true">
            <LegendItem>
              <Swatch $kind="owned" /> Owned
            </LegendItem>
            <LegendItem>
              <Swatch $kind="researchable" /> Researchable
            </LegendItem>
            <LegendItem>
              <Swatch $kind="locked" /> Locked
            </LegendItem>
          </Legend>
          <SearchInput
            type="search"
            placeholder="Highlight by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Highlight tech nodes by text"
          />
        </GraphToolbar>
        <TechGraph
          nodes={allNodes}
          tiers={tiers}
          researchable={researchable}
          matches={matches}
          query={q}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
        />
        {selectedId && (
          <DetailPanel
            node={allNodes.find((n) => n.id === selectedId) ?? null}
            onClose={() => setSelectedId(null)}
            armed={armed === selectedId}
            unlock={(() => {
              const n = allNodes.find((x) => x.id === selectedId);
              return n ? unlockHandlersFor(n) : null;
            })()}
          />
        )}
      </Panel>
    );
  }

  // ── List mode (default + small + mobile) ──────────────────────────────
  const q = query.trim().toLowerCase();
  const filtered = allNodes
    .filter((n) => {
      if (filter === "researchable") return researchable.has(n.id);
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

  const sorted = sortNodes(filtered, researchable);

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>TECH TREE</PanelTitle>
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      {subtitle}
      <Controls>
        <FilterRow role="group" aria-label="Filter tech nodes">
          <FilterBtn
            type="button"
            $active={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All
          </FilterBtn>
          <FilterBtn
            type="button"
            $active={filter === "researchable"}
            onClick={() => setFilter("researchable")}
          >
            Researchable
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
              const u = unlockHandlersFor(n);
              return (
                <NodeRow
                  key={n.id}
                  node={n}
                  display={displayState(n, researchable)}
                  expanded={expandedId === n.id}
                  onToggleExpand={() =>
                    setExpandedId((current) => (current === n.id ? null : n.id))
                  }
                  armed={armed === n.id}
                  onArm={u.onArm}
                  onConfirm={u.onConfirm}
                  canUnlock={u.canUnlock}
                  canAfford={u.canAfford}
                  isPending={u.isPending}
                  affordTooltip={u.affordTooltip}
                />
              );
            })
          )}
        </NodeList>
      </Body>
    </Panel>
  );
}

// Sort: researchable-now first, then owned, then locked; within a group by
// science cost ascending then alphabetically. The cheapest researchable node
// surfaces as the clear next-purchase.
function sortNodes(nodes: TechNode[], researchable: Set<string>): TechNode[] {
  const rank = (n: TechNode) =>
    researchable.has(n.id) ? 0 : n.state === "Available" ? 1 : 2;
  return [...nodes].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.scienceCost !== b.scienceCost) return a.scienceCost - b.scienceCost;
    return a.title.localeCompare(b.title);
  });
}

// ── Graph view ──────────────────────────────────────────────────────────────

interface TechGraphProps {
  nodes: TechNode[];
  tiers: Map<string, number>;
  researchable: Set<string>;
  matches: (n: TechNode) => boolean;
  query: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function TechGraph({
  nodes,
  tiers,
  researchable,
  matches,
  query,
  selectedId,
  onSelect,
}: Readonly<TechGraphProps>) {
  const { placed, width, height } = useMemo(
    () => layoutGraph(nodes, tiers),
    [nodes, tiers],
  );
  const posById = useMemo(() => {
    const m = new Map<string, PlacedNode>();
    for (const p of placed) m.set(p.node.id, p);
    return m;
  }, [placed]);

  // Edges: parent → child, drawn from actual positions (variable span).
  const edges = useMemo(() => {
    const list: {
      key: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      highlit: boolean;
    }[] = [];
    for (const p of placed) {
      const child = p;
      for (const parentId of p.node.parents) {
        const parent = posById.get(parentId);
        if (!parent) continue;
        const highlit =
          selectedId !== null &&
          (selectedId === child.node.id || selectedId === parentId);
        list.push({
          key: `${parentId}->${child.node.id}`,
          x1: parent.x + CARD_W,
          y1: parent.y + CARD_H / 2,
          x2: child.x,
          y2: child.y + CARD_H / 2,
          highlit,
        });
      }
    }
    return list;
  }, [placed, posById, selectedId]);

  return (
    <GraphScroll>
      <GraphCanvas style={{ width, height }}>
        <EdgeLayer
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
        >
          {edges.map((e) => {
            const midX = (e.x1 + e.x2) / 2;
            return (
              <path
                key={e.key}
                d={`M ${e.x1} ${e.y1} C ${midX} ${e.y1}, ${midX} ${e.y2}, ${e.x2} ${e.y2}`}
                fill="none"
                stroke={
                  e.highlit
                    ? "var(--color-accent-fg)"
                    : "var(--color-border-strong)"
                }
                strokeWidth={e.highlit ? 2 : 1}
                opacity={e.highlit ? 0.9 : 0.5}
              />
            );
          })}
        </EdgeLayer>
        {placed.map((p) => {
          const ds = displayState(p.node, researchable);
          const dimmed = query !== "" && !matches(p.node);
          return (
            <GraphCard
              key={p.node.id}
              type="button"
              $ds={ds}
              $selected={selectedId === p.node.id}
              $dimmed={dimmed}
              style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}
              onClick={() => onSelect(p.node.id)}
              aria-pressed={selectedId === p.node.id}
              aria-label={`${p.node.title}, ${ds}, ${p.node.scienceCost} science`}
            >
              <GraphCardTitle>{p.node.title}</GraphCardTitle>
              <GraphCardMeta>
                {ds === "owned" ? (
                  <GraphOwned>✓ owned</GraphOwned>
                ) : (
                  <GraphCost $ds={ds}>{p.node.scienceCost} sci</GraphCost>
                )}
              </GraphCardMeta>
            </GraphCard>
          );
        })}
      </GraphCanvas>
    </GraphScroll>
  );
}

interface UnlockHandlers {
  isResearchable: boolean;
  canAfford: boolean;
  canUnlock: boolean;
  isPending: boolean;
  affordTooltip?: string;
  onArm: () => void;
  onConfirm: () => void;
}

interface DetailPanelProps {
  node: TechNode | null;
  onClose: () => void;
  armed: boolean;
  unlock: UnlockHandlers | null;
}

function DetailPanel({
  node,
  onClose,
  armed,
  unlock,
}: Readonly<DetailPanelProps>) {
  if (!node) return null;
  return (
    <Detail role="dialog" aria-label={`${node.title} details`}>
      <DetailHead>
        <DetailTitle>
          {node.title}
          <NodeId>({node.id})</NodeId>
        </DetailTitle>
        <CloseBtn type="button" onClick={onClose} aria-label="Close details">
          ✕
        </CloseBtn>
      </DetailHead>
      {node.description && <Description>{node.description}</Description>}
      <DetailMeta>
        {node.state !== "Available" && <Cost>{node.scienceCost} sci</Cost>}
        {node.parents.length > 0 && (
          <ParentsInline>
            requires{" "}
            {node.parents.map((p, i) => (
              <span key={p}>
                {i > 0 && ", "}
                <ParentChip>{p}</ParentChip>
              </span>
            ))}
          </ParentsInline>
        )}
      </DetailMeta>
      {node.parts.length > 0 && (
        <Parts>
          <PartsLabel>Parts ({node.parts.length})</PartsLabel>
          <PartsList>
            {node.parts.slice(0, 6).map((p) => (
              <PartRow key={p.name} $purchased={p.purchased}>
                <PartTitle title={p.manufacturer || undefined}>
                  {p.title}
                </PartTitle>
                <PartMeta>
                  {p.category && <PartCategory>{p.category}</PartCategory>}
                  {p.purchased && <PartPurchased>✓</PartPurchased>}
                </PartMeta>
              </PartRow>
            ))}
            {node.parts.length > 6 && (
              <PartRow $purchased={false}>
                <PartTitle>+{node.parts.length - 6} more…</PartTitle>
                <PartMeta />
              </PartRow>
            )}
          </PartsList>
        </Parts>
      )}
      {unlock?.isResearchable && (
        <UnlockRow>
          {unlock.isPending ? (
            <PendingBtn type="button" disabled aria-busy="true">
              Unlocking…
            </PendingBtn>
          ) : armed ? (
            <ConfirmBtn type="button" onClick={unlock.onConfirm}>
              Confirm unlock — {node.scienceCost} sci
            </ConfirmBtn>
          ) : (
            <ArmBtn
              type="button"
              onClick={unlock.onArm}
              disabled={!unlock.canUnlock}
              title={unlock.affordTooltip}
            >
              Unlock
            </ArmBtn>
          )}
        </UnlockRow>
      )}
    </Detail>
  );
}

// ── List node row ─────────────────────────────────────────────────────────

interface NodeRowProps {
  node: TechNode;
  display: DisplayState;
  expanded: boolean;
  onToggleExpand: () => void;
  armed: boolean;
  onArm: () => void;
  onConfirm: () => void;
  canUnlock: boolean;
  canAfford: boolean;
  isPending: boolean;
  affordTooltip?: string;
}

function NodeRow({
  node,
  display,
  expanded,
  onToggleExpand,
  armed,
  onArm,
  onConfirm,
  canUnlock,
  canAfford,
  isPending,
  affordTooltip,
}: Readonly<NodeRowProps>) {
  const stateBadgeTone =
    display === "owned"
      ? "go"
      : display === "researchable"
        ? "accent"
        : "muted";
  const badgeLabel =
    display === "owned"
      ? "Owned"
      : display === "researchable"
        ? "Researchable"
        : "Locked";
  // Researchable but unaffordable: grey the row and recolour the cost so the
  // scan is immediate (2026-05-17 session feedback).
  const unaffordable = display === "researchable" && !canAfford;

  return (
    <NodeRowWrap $display={display} $unaffordable={unaffordable}>
      <NodeHeader
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
      >
        <NodeTitle>
          <NodeTitleText>{node.title}</NodeTitleText>
          <NodeId>({node.id})</NodeId>
        </NodeTitle>
        <NodeMeta>
          {display !== "owned" && (
            <Cost $insufficient={unaffordable}>{node.scienceCost} sci</Cost>
          )}
          <StateBadge $tone={stateBadgeTone}>{badgeLabel}</StateBadge>
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
          {display === "researchable" && (
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

// ── Shared colour helpers ───────────────────────────────────────────────────

function dsBorder(ds: DisplayState): string {
  return ds === "owned"
    ? "var(--color-status-go-fg)"
    : ds === "researchable"
      ? "var(--color-accent-fg)"
      : "var(--color-text-faint)";
}

// ── Styles ────────────────────────────────────────────────────────────────

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
`;

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

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
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

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
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

const NodeRowWrap = styled.li<{
  $display: DisplayState;
  $unaffordable?: boolean;
}>`
  display: flex;
  flex-direction: column;
  background: var(--color-surface-panel);
  border-left: 2px solid
    ${(p) => (p.$unaffordable ? "var(--color-text-faint)" : dsBorder(p.$display))};
  border-radius: 2px;
  opacity: ${(p) =>
    p.$display === "locked" ? 0.65 : p.$unaffordable ? 0.7 : 1};
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
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
`;

// The truncation lives on a flex child that is allowed to shrink: it needs
// flex:1 + min-width:0 so it actually narrows (and ellipsises) within
// NodeTitle instead of overflowing and colliding with the node id / meta.
const NodeTitleText = styled.span`
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
  flex-shrink: 0;
`;

const NodeMeta = styled.span`
  display: inline-flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
`;

const Cost = styled.span<{ $insufficient?: boolean }>`
  font-size: 11px;
  color: ${(p) =>
    p.$insufficient ? "var(--color-status-nogo-fg)" : "var(--color-accent-fg)"};
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
    p.$tone === "go" ? "var(--color-status-go-bg)" : "transparent"};
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

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
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

// ── Graph styles ────────────────────────────────────────────────────────────

const GraphToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
`;

const Legend = styled.div`
  display: inline-flex;
  gap: 12px;
`;

const LegendItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
`;

const Swatch = styled.span<{ $kind: DisplayState }>`
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 2px solid ${(p) => dsBorder(p.$kind)};
  background: ${(p) =>
    p.$kind === "owned"
      ? "var(--color-status-go-bg)"
      : "var(--color-surface-sunken)"};
`;

const GraphScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: 2px;
  background: var(--color-surface-sunken);
  scrollbar-width: thin;
`;

const GraphCanvas = styled.div`
  position: relative;
`;

const EdgeLayer = styled.svg`
  position: absolute;
  inset: 0;
  pointer-events: none;
`;

const GraphCard = styled.button<{
  $ds: DisplayState;
  $selected: boolean;
  $dimmed: boolean;
}>`
  position: absolute;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 1px;
  padding: 4px 8px;
  overflow: hidden;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  border-radius: 3px;
  border: 1px solid ${(p) => dsBorder(p.$ds)};
  border-left-width: 3px;
  background: ${(p) =>
    p.$ds === "owned"
      ? "var(--color-status-go-bg)"
      : p.$ds === "researchable"
        ? "var(--color-surface-raised)"
        : "var(--color-surface-panel)"};
  opacity: ${(p) => (p.$dimmed ? 0.3 : p.$ds === "locked" ? 0.7 : 1)};
  box-shadow: ${(p) =>
    p.$selected ? "0 0 0 2px var(--color-accent-fg)" : "none"};
  transition: opacity 120ms ease;

  &:hover {
    filter: brightness(1.12);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const GraphCardTitle = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-primary);
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
`;

const GraphCardMeta = styled.span`
  display: inline-flex;
  align-items: baseline;
`;

const GraphCost = styled.span<{ $ds: DisplayState }>`
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: ${(p) =>
    p.$ds === "researchable"
      ? "var(--color-accent-fg)"
      : "var(--color-text-muted)"};
`;

const GraphOwned = styled.span`
  font-size: 10px;
  color: var(--color-status-go-fg);
  letter-spacing: 0.04em;
`;

// ── Detail panel ─────────────────────────────────────────────────────────────

const Detail = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  margin-top: 6px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-strong);
  border-radius: 3px;
  max-height: 40%;
  overflow: auto;
`;

const DetailHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
`;

const DetailTitle = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
`;

const CloseBtn = styled.button`
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 2px;
  font-family: inherit;

  &:hover {
    color: var(--color-text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const DetailMeta = styled.div`
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--color-text-muted);
`;

const ParentsInline = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  flex-wrap: wrap;
  font-size: 10px;
  letter-spacing: 0.04em;
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
    "Browse and unlock career-mode tech nodes. At wide sizes it renders the in-game-style tiered dependency graph (columns by longest-path depth, connectors from each parent to its children, colour-coded owned / researchable / locked); at narrow sizes it falls back to a filterable, searchable list with the full part manifest per node.",
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
