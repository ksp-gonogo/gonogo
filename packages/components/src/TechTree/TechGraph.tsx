import { NULL_DISPLAY, Unit } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import {
  CARD_H,
  CARD_W,
  displayState,
  layoutGraph,
  type PlacedNode,
} from "./graph-layout";
import {
  EdgeLayer,
  GraphCanvas,
  GraphCard,
  GraphCardMeta,
  GraphCardTitle,
  GraphCost,
  GraphOwned,
  GraphScroll,
} from "./styles";
import type { TechNode } from "./wire";

interface TechGraphProps {
  nodes: TechNode[];
  tiers: Map<string, number>;
  researchable: Set<string>;
  matches: (n: TechNode) => boolean;
  query: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function TechGraph({
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
                  <GraphOwned $dimmed={dimmed}>✓ owned</GraphOwned>
                ) : (
                  <GraphCost $ds={ds} $dimmed={dimmed}>
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
