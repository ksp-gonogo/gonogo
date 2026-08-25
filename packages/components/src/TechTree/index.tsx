import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  getSizeBucket,
  registerComponent,
  useGameContext,
} from "@ksp-gonogo/core";
import {
  META_VANTAGE,
  type Reading,
  useCommand,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  type CommandButtonHandle,
  Panel,
  ScrollArea,
  Unit,
  usePanelDelay,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import styled from "styled-components";
import {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "../shared/magnitude";

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
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

/**
 * Defensive parser for tech-node array payloads. Accepts BOTH the legacy
 * GonogoTelemetry `tech.nodes` shape (an explicit `state: "Available" |
 * "Researchable" | "Unavailable"` string) and the career-detail wire
 * shape (`career.status.tech.nodes`, CareerViewProvider.BuildTechNodes:
 * `unlocked: boolean`, no `state` at all: the server deliberately doesn't
 * compute the 3-state "Researchable" distinction). When `state` is absent,
 * derive it from `unlocked`
 * (`true` -> "Available", `false` -> "Unavailable"): `computeResearchable`
 * below already promotes some "Unavailable" nodes to researchable-now purely
 * from `state`/`parents`/`scienceCost`, exactly the client-side derivation
 * the extend session's doc comment anticipated. `description`/`parts` stay
 * empty on the new wire (no equivalent field), both already default
 * gracefully. Drops malformed entries; tolerates missing optional fields
 * (description, parts) so an older provider degrades gracefully, the
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
      // Compared against the available science to gate the Unlock button.
      scienceCost: magnitudeOr(e.scienceCost as Quantityish, 0),
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
 * off `state`: filtering on `state === "Researchable"` matches nothing a real
 * save produces, and paints an empty tree. Test fixtures that set an explicit
 * `"Researchable"` state are also honoured.
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
    if (science !== null && n.scienceCost > science) continue;
    out.add(n.id);
  }
  return out;
}

/**
 * Longest-path depth from a root (a parentless node is tier 0). Variable-span
 * edges are fine, a tier-5 node may have a tier-0 parent. Cycle-guarded.
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
  // Science reads canonically off `career.status.economy.science`; the tech
  // nodes off `career.status.tech.nodes`: the wire carries
  // id/title/scienceCost/unlocked/parents per node
  // and parseTechNodes derives the
  // Available/Unavailable state from `unlocked` client-side (no
  // server-computed Researchable 3rd state: this widget's own
  // computeResearchable already does that derivation). The scene reads off
  // `spaceCenter.scene.scene` (already an enum-name string on the wire).
  // tech.unlock[...] (the spend command) still has no command home
  // (KNOWN_COMMAND_GAPS) and falls back to legacy automatically, only the
  // reads migrate here.
  // One read of the record, two fields off it: the tech list and the science
  // balance are the same payload and cannot differ in how current they are.
  /**
   * One record, two fields, two different currency decisions.
   *
   * The node list is a fact. A node's state changes when the player spends on
   * it, and nobody can spend down a link that is not delivering, so the last
   * tree received is still the tree. Withholding it would blank a catalogue
   * that is demonstrably still accurate and leave the operator unable even to
   * browse what they own.
   *
   * The science balance is the input to a verdict, `canAfford` below, which
   * arms a control that spends it. "You can afford this" is a claim about now,
   * and a balance we can no longer vouch for cannot support one, so a stale
   * balance is withheld and every Unlock refuses. `careerNotCurrent` is what
   * lets the refusal say "no longer current" rather than accusing the link of
   * never having delivered.
   */
  const career = topics.useTelemetry("career.status");
  const nodesRaw = stillTrue(career, undefined)?.tech?.nodes;
  const careerScience = judgeable(career)?.economy?.science;
  const careerNotCurrent = notCurrent(career);
  // The game scene is a fact as well: it changes when the player walks through
  // a door, which is an event and not a drift.
  const scene = stillTrue(
    topics.useTelemetry("spaceCenter.scene"),
    undefined,
  )?.scene;
  const { chargesScience } = useGameContext();
  // Unlocking a tech node is an R&D-desk action with no vessel signal delay,
  // so it dispatches at the meta-vantage (instant). The handle is contributed to
  // the panel delay rail by usePanelDelay (draws nothing at meta-vantage).
  const unlockCmd = useCommand("career.tech.unlock", { vantage: META_VANTAGE });
  usePanelDelay(unlockCmd);

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
  // The Unlock button compares this against a node's cost, so it needs the
  // number: left wrapped, every node read as unaffordable.
  const sciAvailable = magnitudeOf(careerScience);

  const researchable = useMemo(
    () => computeResearchable(allNodes ?? [], sciAvailable),
    [allNodes, sciAvailable],
  );
  const tiers = useMemo(() => computeTiers(allNodes ?? []), [allNodes]);

  // ── Loading / empty states ────────────────────────────────────────────
  if (allNodes === null) {
    return (
      <Panel panelTitle="TECH TREE">
        <Empty>Awaiting tech telemetry</Empty>
      </Panel>
    );
  }
  if (allNodes.length === 0) {
    return (
      <Panel panelTitle="TECH TREE">
        <Empty>No tech nodes loaded</Empty>
      </Panel>
    );
  }

  // ── Counts (drive tiny mode + subtitle) ───────────────────────────────
  const counts = { unlocked: 0, researchable: researchable.size };
  for (const n of allNodes) if (n.state === "Available") counts.unlocked++;

  // ── Tiny mode: single-glance summary ─────────────────────────────────
  if (bucket === "tiny") {
    return (
      <Panel panelTitle="TECH" fitToSize>
        <>
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
            /* Tiny mode has room for one short line, and a withheld balance
               has to spend it saying so. Dropping the line silently would make
               a suspended balance look like a save that never had one. */
            careerNotCurrent && <TinySci>SCIENCE NOT CURRENT</TinySci>
          )}
        </>
      </Panel>
    );
  }

  // Unlocking is a Space Center action and it spends science, so an unknown
  // scene WITHHOLDS the button: not knowing where the player is standing is not
  // permission to spend on their behalf.
  const upgradesEnabled = scene === "SpaceCenter";

  const unlockHandlersFor = (n: TechNode) => {
    const isResearchable = researchable.has(n.id);
    // Absent science reads as insufficient science, which is what the comment
    // above `sciAvailable` already claimed this did. Sandbox charges nothing.
    const canAfford = chargesScience
      ? sciAvailable !== null && sciAvailable >= n.scienceCost
      : true;
    const canUnlock = isResearchable && canAfford && upgradesEnabled;
    return {
      isResearchable,
      canAfford,
      canUnlock,
      affordTooltip: !canAfford
        ? sciAvailable === null
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
        /* The balance the Unlock buttons are judged against has to stay on
           screen when it is missing, since that is when they refuse. Which
           kind of missing decides whether the operator distrusts the save or
           the link, so the two get different words. */
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

  // ── Graph mode: tiered dependency view (wide enough only) ────────────
  const useGraph = w !== undefined && w >= GRAPH_MIN_COLS;
  if (useGraph) {
    const q = query.trim().toLowerCase();
    const matches = (n: TechNode) =>
      !q ||
      n.title.toLowerCase().includes(q) ||
      n.id.toLowerCase().includes(q) ||
      n.description.toLowerCase().includes(q);

    return (
      <Panel panelTitle="TECH TREE">
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
            unlockCmd={unlockCmd}
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
    <Panel panelTitle="TECH TREE">
      {subtitle && <TechMeta>{subtitle}</TechMeta>}
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
                  unlockCmd={unlockCmd}
                  canUnlock={u.canUnlock}
                  canAfford={u.canAfford}
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
                  <GraphCost $ds={ds}>
                    {p.node.scienceCost}
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
      {node.description && <Description>{node.description}</Description>}
      <DetailMeta>
        {node.state !== "Available" && (
          <Cost>
            {node.scienceCost}
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
                Confirm unlock: {node.scienceCost}
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

// ── List node row ─────────────────────────────────────────────────────────

interface NodeRowProps {
  node: TechNode;
  display: DisplayState;
  expanded: boolean;
  onToggleExpand: () => void;
  /** See `DetailPanelProps.unlockCmd`. */
  unlockCmd: CommandButtonHandle;
  canUnlock: boolean;
  canAfford: boolean;
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
            <Cost $insufficient={unaffordable}>
              {node.scienceCost}
              <Unit>science</Unit>
            </Cost>
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
                    Confirm unlock: {node.scienceCost}
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

// ── Shared colour helpers ───────────────────────────────────────────────────

function dsBorder(ds: DisplayState): string {
  return ds === "owned"
    ? "var(--color-status-go-fg)"
    : ds === "researchable"
      ? "var(--color-accent-fg)"
      : "var(--color-text-faint)";
}

// ── Styles ────────────────────────────────────────────────────────────────

const Controls = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  /* No horizontal inset of its own any more: Panel.Body supplies exactly the
     16px the title carries, so the pills line up with the title without it.
     Keeping the old local padding here would double the inset and push the
     "Unlocked" pill back past the panel edge at narrow widths (e.g.
     portrait-5x18), which is the clipping the padding was added to avoid. */
  padding-bottom: var(--space-6);
  flex-shrink: 0;
`;

const FilterBar = styled.div`
  display: inline-flex;
  gap: var(--space-4);
  flex-wrap: wrap;
`;

const FilterBtn = styled.button<{ $active: boolean }>`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.06em;
  padding: var(--space-2) var(--space-8);
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
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-xs);
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
    gap: var(--space-4);
  }
`;

const NodeList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
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
  border-radius: var(--radius-xs);
  opacity: ${(p) =>
    p.$display === "locked" ? 0.65 : p.$unaffordable ? 0.7 : 1};
`;

const NodeHeader = styled.button`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-6) var(--space-8);
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
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  font-weight: 600;
  display: flex;
  align-items: baseline;
  gap: var(--space-6);
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
  font-size: var(--font-size-2xs);
  font-family: monospace;
  color: var(--color-text-faint);
  font-weight: 400;
  flex-shrink: 0;
`;

const NodeMeta = styled.span`
  display: inline-flex;
  gap: var(--space-6);
  align-items: center;
  flex-shrink: 0;
`;

const Cost = styled.span<{ $insufficient?: boolean }>`
  font-size: var(--font-size-xs);
  color: ${(p) =>
    p.$insufficient ? "var(--color-status-nogo-fg)" : "var(--color-accent-fg)"};
  font-variant-numeric: tabular-nums;
`;

const StateBadge = styled.span<{ $tone: "go" | "accent" | "muted" }>`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: var(--space-hair) var(--space-6);
  border-radius: var(--radius-xs);
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
  gap: var(--space-8);
  padding: var(--space-4) var(--space-10) var(--space-8);
  border-top: 1px dashed var(--color-surface-raised);
`;

const Description = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  line-height: var(--line-height-body);
  font-style: italic;
`;

const Parents = styled.div`
  display: flex;
  align-items: baseline;
  gap: var(--space-6);
  flex-wrap: wrap;
`;

const ParentsLabel = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const ParentsList = styled.span`
  display: inline-flex;
  gap: var(--space-4);
  flex-wrap: wrap;
`;

const ParentChip = styled.span`
  font-size: var(--font-size-2xs);
  font-family: monospace;
  color: var(--color-text-muted);
  padding: var(--space-hair) var(--space-6);
  background: var(--color-surface-sunken);
  border-radius: var(--radius-xs);
`;

const Parts = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const PartsLabel = styled.span`
  font-size: var(--font-size-2xs);
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
  gap: var(--space-hair);
`;

const PartRow = styled.li<{ $purchased: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-8);
  font-size: var(--font-size-xs);
  padding: var(--space-hair) 0;
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
  gap: var(--space-6);
  align-items: baseline;
  flex-shrink: 0;
`;

const PartCategory = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const PartCost = styled.span`
  font-size: var(--font-size-2xs);
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

const PartPurchased = styled.span`
  font-size: var(--font-size-2xs);
  color: var(--color-status-go-fg);
`;

const UnlockRow = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-xs);
  padding: var(--space-12);
  text-align: center;
`;

const SciReadout = styled.span`
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
  margin-left: var(--space-2);
`;

const TechMeta = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  margin-bottom: var(--space-6);
`;

// ── Graph styles ────────────────────────────────────────────────────────────

const GraphToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  flex-shrink: 0;
  flex-wrap: wrap;
`;

const Legend = styled.div`
  display: inline-flex;
  gap: var(--space-12);
`;

const LegendItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  font-size: var(--font-size-2xs);
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
`;

const Swatch = styled.span<{ $kind: DisplayState }>`
  width: 10px;
  height: 10px;
  border-radius: var(--radius-xs);
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
  border-radius: var(--radius-xs);
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
  gap: var(--space-hair);
  padding: var(--space-4) var(--space-8);
  overflow: hidden;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  border-radius: var(--radius-sm);
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

/* GraphCard's type stays off both scales. The card is laid out at a fixed
   JS height (CARD_H = 48, applied as an inline style), and after borders,
   padding and gap the content budget is 37px against a current 2 x 11 x
   1.15 title plus a ~12px meta row, i.e. already flush. --line-height-tight
   (1.2) alone overflows it, and on a coarse pointer --font-size-xs (12px)
   plus --font-size-2xs (11px) need roughly 42px, which GraphCard's
   overflow: hidden would clip mid-line. Moving any of these four values
   means raising CARD_H in the same edit and re-checking the
   -webkit-line-clamp: 2. */
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
  /* Off the type scale with GraphCardTitle above: same CARD_H budget. */
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: ${(p) =>
    p.$ds === "researchable"
      ? "var(--color-accent-fg)"
      : "var(--color-text-muted)"};
`;

const GraphOwned = styled.span`
  /* Off the type scale with GraphCardTitle above: same CARD_H budget. */
  font-size: 10px;
  color: var(--color-status-go-fg);
  letter-spacing: 0.04em;
`;

// ── Detail panel ─────────────────────────────────────────────────────────────

const Detail = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-8) var(--space-10);
  margin-top: var(--space-6);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  max-height: 40%;
  overflow: auto;
`;

const DetailHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-8);
`;

const DetailTitle = styled.span`
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-6);
`;

const CloseBtn = styled.button`
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-base);
  line-height: var(--line-height-flush);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-xs);
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
  gap: var(--space-12);
  flex-wrap: wrap;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;

const ParentsInline = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-4);
  flex-wrap: wrap;
  font-size: var(--font-size-2xs);
  letter-spacing: 0.04em;
`;

// ── Tiny mode ──────────────────────────────────────────────────────────────

const TinyCount = styled.div`
  /* Off the type scale: the scale stops at --font-size-lg (16px) and this
     is a display-tier readout. */
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
  /* Off the type scale: 2px below --font-size-2xs, the smallest rung. */
  font-size: 8px;
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
  margin-top: var(--space-2);
`;

const TinySci = styled.span`
  font-size: var(--font-size-2xs);
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
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["career"],
});

export { TechTreeComponent };
