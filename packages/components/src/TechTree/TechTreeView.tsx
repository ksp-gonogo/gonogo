import { getSizeBucket } from "@ksp-gonogo/core";
import type { CommandButtonHandle, UnitValue } from "@ksp-gonogo/ui-kit";
import { Panel, Section, Unit } from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import { DetailPanel } from "./DetailPanel";
import {
  computeResearchable,
  computeTiers,
  displayState,
  GRAPH_MIN_COLS,
} from "./graph-layout";
import { NodeRow } from "./NodeRow";
import {
  Controls,
  Empty,
  FilterBar,
  FilterBtn,
  GraphToolbar,
  Legend,
  LegendItem,
  NodeList,
  SciReadout,
  SearchInput,
  Swatch,
  TechMeta,
  TinyCount,
  TinyLabel,
  TinySci,
} from "./styles";
import { TechGraph } from "./TechGraph";
import { unlockHandlersFor } from "./unlock";
import { sortNodes, type TechNode } from "./wire";

export interface TechTreeViewProps {
  w?: number;
  h?: number;
  allNodes: TechNode[] | null;
  sciAvailable: number | null;
  careerNotCurrent: boolean;
  /** The science balance as drawn, held included so Unit can mark it. */
  scienceShown: UnitValue<"science">;
  chargesScience: boolean;
  unlockCmd: CommandButtonHandle;
  unlockBlocked: boolean;
}

/** The subtitle's science balance; it stays on screen when missing, since that is when the Unlocks refuse. */
function ScienceBalance({
  sciAvailable,
  careerNotCurrent,
  scienceShown,
  chargesScience,
}: {
  sciAvailable: number | null;
  careerNotCurrent: boolean;
  scienceShown: UnitValue<"science">;
  chargesScience: boolean;
}) {
  if (sciAvailable !== null) {
    return (
      <SciReadout title="Available science">
        · {Math.round(sciAvailable)}
        <Unit>science</Unit>
      </SciReadout>
    );
  }
  if (!chargesScience) return null;
  if (careerNotCurrent) {
    return (
      <SciReadout title="Available science">
        · <Unit value={scienceShown} decimals={0} />
      </SciReadout>
    );
  }
  return (
    <SciReadout title="No science balance has arrived">
      · science unknown
    </SciReadout>
  );
}

export function TechTreeView({
  w,
  h,
  allNodes,
  sciAvailable,
  careerNotCurrent,
  scienceShown,
  chargesScience,
  unlockCmd,
  unlockBlocked,
}: Readonly<TechTreeViewProps>) {
  const [filter, setFilter] = useState<"all" | "researchable" | "unlocked">(
    "all",
  );
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const bucket = getSizeBucket(w, h);
  const rows = h ?? 8;
  const showSubtitle = rows >= 4;

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
            {sciAvailable !== null && (
              <TinySci>
                {Math.round(sciAvailable)}
                <Unit>science</Unit>
              </TinySci>
            )}
            {sciAvailable === null && careerNotCurrent && (
              <TinySci>
                <Unit value={scienceShown} decimals={0} />
              </TinySci>
            )}
          </Section>
        }
      />
    );
  }

  const unlockContext = {
    researchable,
    chargesScience,
    unlockBlocked,
    sciAvailable,
    careerNotCurrent,
  };

  const subtitle = showSubtitle ? (
    <span role="status" aria-live="polite">
      {counts.unlocked}/{allNodes.length} unlocked · {counts.researchable}{" "}
      researchable{" "}
      <ScienceBalance
        sciAvailable={sciAvailable}
        careerNotCurrent={careerNotCurrent}
        scienceShown={scienceShown}
        chargesScience={chargesScience}
      />
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

    const selectedNode = allNodes.find((n) => n.id === selectedId) ?? null;
    const selectedUnlock = selectedNode
      ? unlockHandlersFor(selectedNode, unlockContext)
      : null;

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
                node={selectedNode}
                onClose={() => setSelectedId(null)}
                unlockCmd={unlockCmd}
                unlock={selectedUnlock}
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
                const u = unlockHandlersFor(n, unlockContext);
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
