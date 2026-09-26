import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  getSizeBucket,
  registerComponent,
  useGameContext,
} from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import { stillTrue, value } from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  type CommandButtonHandle,
  ExpandableText,
  NULL_DISPLAY,
  Panel,
  Section,
  Unit,
  usePanelDelay,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import styled from "styled-components";
import { asQuantityish, magnitudeOf } from "../shared/magnitude";

const topics = defineTopicManifest({
  channels: ["career.status", "spaceCenter.scene"],
  fields: [
    "career.status.tech.nodes",
    "career.status.economy.science",
    "spaceCenter.scene.scene",
  ],
});

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

/** A price that never arrived sorts after every real one rather than as free. */
function sortCost(n: { scienceCost: number | null }): number {
  return n.scienceCost ?? Number.POSITIVE_INFINITY;
}

export interface TechNode {
  id: string;
  title: string;
  description: string;
  /** `null` when the wire carried no price, which is not a free node. */
  scienceCost: number | null;
  state: TechNodeState;
  parents: string[];
  parts: TechPart[];
}

/**
 * Parses tech-node arrays in either wire shape: an explicit `state` string, or `career.status.tech.nodes`, which carries only `unlocked` (mapped to "Available" / "Unavailable"; researchable-now is derived by `computeResearchable`). Drops malformed entries and tolerates missing optional fields.
 */
export function parseTechNodes(raw: unknown): TechNode[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: TechNode[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
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
      // Compared against the available science to gate the Unlock button.
      scienceCost: magnitudeOf(asQuantityish(e.scienceCost)),
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

// The tiered graph needs width to be legible; below this, and with unmeasured dims, the widget draws the compact list.
const GRAPH_MIN_COLS = 10;

/**
 * A node is researchable-now when it is not owned, every parent is unlocked, and its cost is affordable. The plugin only emits `Available` / `Unavailable`, so this is computed; an explicit `"Researchable"` state is also honoured.
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
      // Explicit state from a fixture / older payload, trust it.
      out.add(n.id);
      continue;
    }
    const parentsUnlocked = n.parents.every(
      (p) => byId.get(p)?.state === "Available",
    );
    if (!parentsUnlocked) continue;
    if (science !== null && n.scienceCost !== null && n.scienceCost > science)
      continue;
    out.add(n.id);
  }
  return out;
}

/** Longest-path depth from a root (a parentless node is tier 0); edges may span tiers. Cycle-guarded. */
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

/** Assigns each node a (tier, row) slot, then orders rows within a column by the mean row of their parents to cut most edge crossings. */
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
      (a, b) => sortCost(a) - sortCost(b) || a.title.localeCompare(b.title),
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
          sortCost(a) - sortCost(b),
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

function TechTreeComponent({ w, h }: Readonly<ComponentProps<TechTreeConfig>>) {
  /*
   * One record, two currency decisions. The node list is a fact (nobody can spend down a link that is not delivering), so a held tree is still the tree.
   * The science balance feeds `canAfford`, a claim about now that arms a spend, so a stale balance is withheld and every Unlock refuses.
   */
  const career = topics.useTelemetry("career.status");
  const nodesRaw = stillTrue(career, undefined)?.tech?.nodes;
  const careerScience =
    career.state === "observed" ? career.value.economy?.science : undefined;
  const careerNotCurrent = career.state === "stale";
  // The game scene is a fact as well: it changes when the player walks through a door, which is an event and not a drift.
  const scene = stillTrue(
    topics.useTelemetry("spaceCenter.scene"),
    undefined,
  )?.scene;
  const { chargesScience } = useGameContext();
  // An R&D-desk action with no vessel signal delay, so it dispatches at the meta-vantage.
  const unlockCmd = useCommand("career.tech.unlock", { vantage: META_VANTAGE });
  usePanelDelay(unlockCmd);
  // A career model that refuses `career.tech.unlock` (RP-1 researches through its own queue) refuses for a reason the balance has no part in, so no affordability verdict is drawn.
  const unlockBlocked = unlockCmd.gate?.blocked === true;

  const allNodes = parseTechNodes(nodesRaw);

  const [filter, setFilter] = useState<"all" | "researchable" | "unlocked">(
    "all",
  );
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const bucket = getSizeBucket(w, h);
  const rows = h ?? 8;
  const showSubtitle = rows >= 4;
  // Unwrapped because the Unlock button compares it against a node's cost.
  const sciAvailable = magnitudeOf(careerScience);

  const researchable = useMemo(
    () => computeResearchable(allNodes ?? [], sciAvailable),
    [allNodes, sciAvailable],
  );
  const tiers = useMemo(() => computeTiers(allNodes ?? []), [allNodes]);

  if (allNodes === null) {
    return (
      <Panel
        panelTitle="TECH TREE"
        compactTitle={["TECH"]}
        sections={
          <Section full>
            <Empty>Awaiting tech telemetry</Empty>
          </Section>
        }
      />
    );
  }
  if (allNodes.length === 0) {
    return (
      <Panel
        panelTitle="TECH TREE"
        compactTitle={["TECH"]}
        sections={
          <Section full>
            <Empty>No tech nodes loaded</Empty>
          </Section>
        }
      />
    );
  }

  const counts = { unlocked: 0, researchable: researchable.size };
  for (const n of allNodes) if (n.state === "Available") counts.unlocked++;

  if (bucket === "tiny") {
    return (
      <Panel
        panelTitle="TECH"
        fitToSize
        sections={
          <Section full>
            <TinyCount>
              {counts.researchable}
              <TinyLabel>RESEARCHABLE</TinyLabel>
            </TinyCount>
            {sciAvailable !== null ? (
              <TinySci>
                {Math.round(sciAvailable)}
                <Unit>science</Unit>
              </TinySci>
            ) : (
              /* A withheld balance spends tiny mode's one line saying so, or it looks like a save that never had one. */
              careerNotCurrent && <TinySci>SCIENCE NOT CURRENT</TinySci>
            )}
          </Section>
        }
      />
    );
  }

  // Unlocking spends science at the Space Center, so an unknown scene withholds the button.
  const upgradesEnabled = scene === "SpaceCenter";

  const unlockHandlersFor = (n: TechNode) => {
    const isResearchable = researchable.has(n.id);
    // Absent science reads as insufficient science; sandbox charges nothing.
    const moneyDecides = chargesScience && !unlockBlocked;
    const canAfford =
      !moneyDecides ||
      (sciAvailable !== null &&
        n.scienceCost !== null &&
        sciAvailable >= n.scienceCost);
    const canUnlock = isResearchable && canAfford && upgradesEnabled;
    return {
      isResearchable,
      canAfford,
      moneyDecides,
      canUnlock,
      affordTooltip: !canAfford
        ? n.scienceCost === null
          ? "No price reported for this node"
          : sciAvailable === null
            ? careerNotCurrent
              ? `Need ${writeQuantity(value("science", n.scienceCost))} (the science balance is no longer current)`
              : `Need ${writeQuantity(value("science", n.scienceCost))} (no science balance has arrived)`
            : `Need ${writeQuantity(value("science", n.scienceCost))} (have ${sciAvailable})`
        : !upgradesEnabled
          ? "Unlock from the Space Center scene"
          : undefined,
    };
  };

  const subtitle = showSubtitle ? (
    <span role="status" aria-live="polite">
      {counts.unlocked}/{allNodes.length} unlocked · {counts.researchable}{" "}
      researchable{" "}
      {sciAvailable !== null ? (
        <SciReadout title="Available science">
          · {Math.round(sciAvailable)}
          <Unit>science</Unit>
        </SciReadout>
      ) : (
        /* The balance stays on screen when it is missing, since that is when the Unlocks refuse; a save without one and a link that stopped get different words. */
        chargesScience &&
        (careerNotCurrent ? (
          <SciReadout title="The science balance is no longer current">
            · science not current
          </SciReadout>
        ) : (
          <SciReadout title="No science balance has arrived">
            · science unknown
          </SciReadout>
        ))
      )}
    </span>
  ) : undefined;

  const useGraph = w !== undefined && w >= GRAPH_MIN_COLS;
  if (useGraph) {
    const q = query.trim().toLowerCase();
    const matches = (n: TechNode) =>
      !q ||
      n.title.toLowerCase().includes(q) ||
      n.id.toLowerCase().includes(q) ||
      n.description.toLowerCase().includes(q);

    return (
      <Panel
        panelTitle="TECH TREE"
        compactTitle={["TECH"]}
        sections={[
          <Section key="meta" full>
            {subtitle && <TechMeta>{subtitle}</TechMeta>}
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
                placeholder="Highlight by name..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Highlight tech nodes by text"
              />
            </GraphToolbar>
          </Section>,
          <Section key="graph" fill>
            <TechGraph
              nodes={allNodes}
              tiers={tiers}
              researchable={researchable}
              matches={matches}
              query={q}
              selectedId={selectedId}
              onSelect={(id) =>
                setSelectedId((cur) => (cur === id ? null : id))
              }
            />
          </Section>,
          <Section key="detail" full>
            {selectedId && (
              <DetailPanel
                node={allNodes.find((n) => n.id === selectedId) ?? null}
                onClose={() => setSelectedId(null)}
                unlockCmd={unlockCmd}
                unlock={(() => {
                  const n = allNodes.find((x) => x.id === selectedId);
                  return n ? unlockHandlersFor(n) : null;
                })()}
              />
            )}
          </Section>,
        ]}
      />
    );
  }

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
    <Panel
      panelTitle="TECH TREE"
      compactTitle={["TECH"]}
      /* The filter pills and search box are a full-width control row, pinned under the header outside the scroller. */
      panelToolbar={
        <Controls>
          <FilterBar role="group" aria-label="Filter tech nodes">
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
          </FilterBar>
          <SearchInput
            type="search"
            placeholder="Filter by name or description..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter tech nodes by text"
          />
        </Controls>
      }
      /* No ScrollArea here: Panel's body is already the scroller. */
      sections={[
        subtitle && (
          <Section key="meta" full>
            <TechMeta>{subtitle}</TechMeta>
          </Section>
        ),
        <Section key="nodes" full>
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
                      setExpandedId((current) =>
                        current === n.id ? null : n.id,
                      )
                    }
                    unlockCmd={unlockCmd}
                    canUnlock={u.canUnlock}
                    canAfford={u.canAfford}
                    moneyDecides={u.moneyDecides}
                    affordTooltip={u.affordTooltip}
                  />
                );
              })
            )}
          </NodeList>
        </Section>,
      ]}
    />
  );
}

// Researchable-now first, then owned, then locked; within a group by cost then title, so the cheapest researchable node surfaces first.
function sortNodes(nodes: TechNode[], researchable: Set<string>): TechNode[] {
  const rank = (n: TechNode) =>
    researchable.has(n.id) ? 0 : n.state === "Available" ? 1 : 2;
  return [...nodes].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (sortCost(a) !== sortCost(b)) return sortCost(a) - sortCost(b);
    return a.title.localeCompare(b.title);
  });
}

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

  // Edges run parent to child, drawn from actual positions.
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
              aria-label={`${p.node.title}, ${ds}, ${p.node.scienceCost ?? "unknown"} science`}
            >
              <GraphCardTitle>{p.node.title}</GraphCardTitle>
              <GraphCardMeta>
                {ds === "owned" ? (
                  <GraphOwned>✓ owned</GraphOwned>
                ) : (
                  <GraphCost $ds={ds}>
                    {p.node.scienceCost ?? NULL_DISPLAY}
                    <Unit>science</Unit>
                  </GraphCost>
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
  affordTooltip?: string;
}

interface DetailPanelProps {
  node: TechNode | null;
  onClose: () => void;
  /**
   * The shared unlock handle. The control's own `CommandButton` holds its arm
   * and in-flight state, so no armed-id or pending-id travels down here.
   */
  unlockCmd: CommandButtonHandle;
  unlock: UnlockHandlers | null;
}

function DetailPanel({
  node,
  onClose,
  unlockCmd,
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
      {node.description && (
        <Description>
          <ExpandableText subject={node.title}>
            {node.description}
          </ExpandableText>
        </Description>
      )}
      <DetailMeta>
        {node.state !== "Available" && (
          <Cost>
            {node.scienceCost ?? NULL_DISPLAY}
            <Unit>science</Unit>
          </Cost>
        )}
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
                <PartTitle>+{node.parts.length - 6} more...</PartTitle>
                <PartMeta />
              </PartRow>
            )}
          </PartsList>
        </Parts>
      )}
      {unlock?.isResearchable && (
        <UnlockRow>
          <CommandButton
            handle={unlockCmd}
            args={{ techId: node.id }}
            commandLabel={`Unlock ${node.title}`}
            size="sm"
            label="Unlock"
            confirmLabel={
              <>
                Confirm unlock: {node.scienceCost ?? NULL_DISPLAY}
                <Unit>science</Unit>
              </>
            }
            pendingLabel="Unlocking..."
            disabled={!unlock.canUnlock}
            title={unlock.affordTooltip}
          />
        </UnlockRow>
      )}
    </Detail>
  );
}

interface NodeRowProps {
  node: TechNode;
  display: DisplayState;
  expanded: boolean;
  onToggleExpand: () => void;
  /** See `DetailPanelProps.unlockCmd`. */
  unlockCmd: CommandButtonHandle;
  canUnlock: boolean;
  canAfford: boolean;
  /** Whether the balance decides this unlock at all; false where the command is refused outright or nothing charges science. */
  moneyDecides: boolean;
  affordTooltip?: string;
}

function NodeRow({
  node,
  display,
  expanded,
  onToggleExpand,
  unlockCmd,
  canUnlock,
  canAfford,
  moneyDecides,
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
  // Researchable but unaffordable: grey the row and recolour the cost.
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
            <Cost
              $insufficient={unaffordable}
              // Exposed so the verdict can be asserted rather than read off a colour; absent where money decides nothing.
              data-afford={
                display === "researchable" && moneyDecides
                  ? canAfford
                    ? "yes"
                    : "no"
                  : undefined
              }
            >
              {node.scienceCost ?? NULL_DISPLAY}
              <Unit>science</Unit>
            </Cost>
          )}
          <StateBadge $tone={stateBadgeTone}>{badgeLabel}</StateBadge>
        </NodeMeta>
      </NodeHeader>
      {expanded && (
        <NodeBody>
          {node.description && (
            <Description>
              <ExpandableText subject={node.title}>
                {node.description}
              </ExpandableText>
            </Description>
          )}
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
                        <PartCost>
                          <Unit value={value("funds", p.entryCost)} />
                        </PartCost>
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
              <CommandButton
                handle={unlockCmd}
                args={{ techId: node.id }}
                commandLabel={`Unlock ${node.title}`}
                size="sm"
                label="Unlock"
                confirmLabel={
                  <>
                    Confirm unlock: {node.scienceCost ?? NULL_DISPLAY}
                    <Unit>science</Unit>
                  </>
                }
                pendingLabel="Unlocking..."
                disabled={!canUnlock}
                title={affordTooltip}
              />
            </UnlockRow>
          )}
        </NodeBody>
      )}
    </NodeRowWrap>
  );
}

function dsBorder(ds: DisplayState): string {
  return ds === "owned"
    ? "var(--color-status-go-fg)"
    : ds === "researchable"
      ? "var(--color-accent-fg)"
      : "var(--color-text-faint)";
}

const Controls = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  /* No horizontal inset: Panel.Body already aligns the pills with the title. */
  padding-bottom: var(--gap-related-compact);
  flex-shrink: 0;
`;

const FilterBar = styled.div`
  display: inline-flex;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

const FilterBtn = styled.button<{ $active: boolean }>`
  font-size: var(--font-size-compact);
  letter-spacing: 0.06em;
  padding: var(--inset-control);
  border-radius: var(--radius-pill);
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
  padding: var(--inset-control);
  border-radius: var(--radius-regular);
  outline: none;

  &:focus {
    border-color: var(--color-accent-fg);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const NodeList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
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
  border-radius: var(--radius-regular);
  opacity: ${(p) =>
    p.$display === "locked" ? 0.65 : p.$unaffordable ? 0.7 : 1};
`;

const NodeHeader = styled.button`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--gap-related);
  /* A record rather than a control, so --inset-surface: it has no --control-height floor. */
  padding: var(--inset-surface);
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
  font-size: var(--font-size-value);
  color: var(--color-text-primary);
  font-weight: 600;
  display: flex;
  align-items: baseline;
  gap: var(--gap-related);
  flex: 1 1 8rem;
  min-width: 0;
  overflow: hidden;
`;

// `min-width: 0` lets the title ellipsise inside NodeTitle instead of colliding with the id, and the basis holds its width until the id gives way.
const NodeTitleText = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

// Gives way before the title does: the name is what a row is read by.
const NodeId = styled.span`
  font-size: var(--font-size-caption);
  font-family: var(--font-family-mono);
  color: var(--color-text-faint);
  font-weight: 400;
  flex: 0 1000 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const NodeMeta = styled.span`
  display: inline-flex;
  gap: var(--gap-related);
  align-items: center;
  flex-shrink: 0;
`;

const Cost = styled.span<{ $insufficient?: boolean }>`
  font-size: var(--font-size-compact);
  color: ${(p) =>
    p.$insufficient ? "var(--color-status-nogo-fg)" : "var(--color-accent-fg)"};
  font-variant-numeric: tabular-nums;
`;

const StateBadge = styled.span<{ $tone: "go" | "accent" | "muted" }>`
  font-size: var(--font-size-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: var(--inset-chip);
  border-radius: var(--radius-regular);
  color: ${(p) =>
    p.$tone === "go"
      ? "var(--color-status-go-fg)"
      : p.$tone === "accent"
        ? "var(--color-accent-fg)"
        : "var(--color-text-faint)"};
  background: ${(p) =>
    p.$tone === "go" ? "var(--color-status-go-bg)" : "transparent"};
`;

// Description, requires list, parts list and unlock control are different kinds of block, so the seam is --gap-section.
const NodeBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  padding: var(--inset-node-body);
  border-top: 1px dashed var(--color-surface-raised);
`;

const Description = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  line-height: var(--line-height-body);
  font-style: italic;
`;

const Parents = styled.div`
  display: flex;
  align-items: baseline;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

const ParentsLabel = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const ParentsList = styled.span`
  display: inline-flex;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

const ParentChip = styled.span`
  font-size: var(--font-size-caption);
  font-family: var(--font-family-mono);
  color: var(--color-text-muted);
  padding: var(--inset-chip);
  background: var(--color-surface-sunken);
  border-radius: var(--radius-regular);
`;

const Parts = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const PartsLabel = styled.span`
  font-size: var(--font-size-caption);
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
  gap: var(--gap-line);
`;

const PartRow = styled.li<{ $purchased: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--gap-related);
  font-size: var(--font-size-compact);
  padding: var(--inset-part-row);
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
  gap: var(--gap-related);
  align-items: baseline;
  flex-shrink: 0;
`;

const PartCategory = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const PartCost = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

const PartPurchased = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-status-go-fg);
`;

const UnlockRow = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-compact);
  padding: var(--inset-tile-message);
  text-align: center;
`;

const SciReadout = styled.span`
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
  margin-left: var(--gap-lead-figure);
`;

const TechMeta = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-compact);
  margin-bottom: var(--gap-related-compact);
`;

const GraphToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-section);
  flex-shrink: 0;
  flex-wrap: wrap;
`;

// --gap-section between legend entries and --gap-related inside one, or the swatches and words run together.
const Legend = styled.div`
  display: inline-flex;
  gap: var(--gap-section);
`;

const LegendItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--gap-related);
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
`;

const Swatch = styled.span<{ $kind: DisplayState }>`
  width: 10px;
  height: 10px;
  border-radius: var(--radius-regular);
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
  border-radius: var(--radius-regular);
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
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: var(--gap-line);
  /* Sized against CARD_H: a taller inset clips the two-line title. */
  padding: var(--inset-graph-card);
  overflow: hidden;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  border-radius: var(--radius-regular);
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
  transition: opacity var(--duration-fast) var(--ease-standard);

  &:hover {
    filter: brightness(1.12);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

// Off both type scales: the fixed CARD_H of 48 leaves a 37px content budget that the title already fills; changing these means raising CARD_H.
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
  /* Off the type scale: the same CARD_H budget as GraphCardTitle. */
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: ${(p) =>
    p.$ds === "researchable"
      ? "var(--color-accent-fg)"
      : "var(--color-text-muted)"};
`;

const GraphOwned = styled.span`
  /* Off the type scale: the same CARD_H budget as GraphCardTitle. */
  font-size: 10px;
  color: var(--color-status-go-fg);
  letter-spacing: 0.04em;
`;

// Different kinds of block in a bordered box, so --gap-section and --inset-surface.
const Detail = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  padding: var(--inset-surface);
  margin-top: var(--gap-related-compact);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-regular);
  max-height: 40%;
  overflow: auto;
`;

const DetailHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gap-related);
`;

const DetailTitle = styled.span`
  font-size: var(--font-size-value);
  font-weight: 600;
  color: var(--color-text-primary);
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-related);
`;

const CloseBtn = styled.button`
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-base);
  line-height: var(--line-height-flush);
  padding: var(--inset-control);
  border-radius: var(--radius-regular);
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
  gap: var(--gap-section);
  flex-wrap: wrap;
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
`;

const ParentsInline = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-related);
  flex-wrap: wrap;
  font-size: var(--font-size-compact);
  letter-spacing: 0.04em;
`;

const TinyCount = styled.div`
  /* Off the type scale: a display-tier readout, above --font-size-lg. */
  font-size: 24px;
  font-weight: 600;
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: var(--line-height-flush);
`;

const TinyLabel = styled.span`
  /* Off the type scale: below --font-size-2xs, the smallest rung. */
  font-size: 8px;
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
  margin-top: var(--gap-caption);
`;

const TinySci = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
`;

registerComponent<TechTreeConfig>({
  id: "tech-tree",
  name: "Tech Tree",
  description:
    "Browse and unlock career-mode tech nodes. At wide sizes it renders the in-game-style tiered dependency graph (columns by longest-path depth, connectors from each parent to its children, colour-coded owned / researchable / locked); at narrow sizes it falls back to a filterable, searchable list with the full part manifest per node.",
  tags: ["career", "tech"],
  defaultSize: { w: 6, h: 9 },
  minSize: { w: 2, h: 2 },
  component: TechTreeComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["career"],
});

export { TechTreeComponent };
