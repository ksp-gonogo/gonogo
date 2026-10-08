import type { Value } from "@ksp-gonogo/sitrep-sdk";
import type { CommandButtonHandle, UnitValue } from "@ksp-gonogo/ui-kit";
import {
  Badge,
  Cluster,
  EmptyState,
  FilterChip,
  FramedDisplay,
  Grid,
  Panel,
  Section,
  Stack,
  Stat,
  Unit,
  useRowFilter,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import { DetailPanel } from "./DetailPanel";
import {
  computeResearchable,
  computeTiers,
  type DisplayState,
  displayState,
  displayTone,
  GRAPH_MIN_COLS,
} from "./graph-layout";
import { NodeRow } from "./NodeRow";
import { TechGraph } from "./TechGraph";
import { unlockHandlersFor } from "./unlock";
import { sortNodes, type TechNode } from "./wire";

export interface TechTreeViewProps {
  w?: number;
  allNodes: TechNode[] | null;
  sciAvailable: number | null;
  /** The current balance the researchable count is judged against. */
  science: Value<"science"> | null | undefined;
  /** The science balance as drawn, held included so Unit can mark it. */
  scienceShown: UnitValue<"science">;
  chargesScience: boolean;
  unlockCmd: CommandButtonHandle;
  unlockBlocked: boolean;
}

const LEGEND: readonly { display: DisplayState; label: string }[] = [
  { display: "owned", label: "Owned" },
  { display: "researchable", label: "Researchable" },
  { display: "locked", label: "Locked" },
];

type ListFilter = "all" | "researchable" | "unlocked";

function searchText(n: TechNode): string {
  return `${n.title} ${n.id} ${n.description}`;
}

/**
 * The core figures. The balance stays on screen when missing, since that is when Unlock refuses; it is drawn wherever science is charged or a balance has arrived.
 */
function TechStats({
  unlocked,
  total,
  researchable,
  showScience,
  scienceShown,
}: Readonly<{
  unlocked: number;
  total: number;
  researchable: number;
  showScience: boolean;
  scienceShown: UnitValue<"science">;
}>) {
  return (
    <Grid
      role="status"
      aria-live="polite"
      minColWidth="7rem"
      fit
      align="stretch"
      gap="related-compact"
    >
      <Stat label="Unlocked">
        {unlocked}/{total}
      </Stat>
      <Stat label="Researchable">{researchable}</Stat>
      {showScience && (
        <Stat label="Science">
          <Unit value={scienceShown} decimals={0} />
        </Stat>
      )}
    </Grid>
  );
}

export function TechTreeView({
  w,
  allNodes,
  sciAvailable,
  science,
  scienceShown,
  chargesScience,
  unlockCmd,
  unlockBlocked,
}: Readonly<TechTreeViewProps>) {
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filter = useRowFilter({
    label: "Search tech nodes",
    placeholder: "Search by name or description...",
  });

  const researchable = useMemo(
    () => computeResearchable(allNodes ?? [], science),
    [allNodes, science],
  );
  const tiers = useMemo(() => computeTiers(allNodes ?? []), [allNodes]);

  if (allNodes === null) {
    return (
      <Panel
        panelTitle="TECH TREE"
        compactTitle={["TECH"]}
        sections={
          <Section full>
            <EmptyState>Awaiting tech telemetry</EmptyState>
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
            <EmptyState>No tech nodes loaded</EmptyState>
          </Section>
        }
      />
    );
  }

  const unlocked = allNodes.filter((n) => n.state === "Available").length;
  const unlockContext = {
    researchable,
    chargesScience,
    unlockBlocked,
    sciAvailable,
  };

  const stats = (
    <Section key="stats" full>
      <TechStats
        unlocked={unlocked}
        total={allNodes.length}
        researchable={researchable.size}
        showScience={chargesScience || sciAvailable !== null}
        scienceShown={scienceShown}
      />
    </Section>
  );

  if (w !== undefined && w >= GRAPH_MIN_COLS) {
    const selectedNode = allNodes.find((n) => n.id === selectedId) ?? null;

    return (
      <Panel
        panelTitle="TECH TREE"
        compactTitle={["TECH"]}
        panelToolbar={
          <Cluster justify="start" gap="related" wrap aria-hidden="true">
            {LEGEND.map(({ display, label }) => (
              <Badge key={display} tone={displayTone(display)} size="sm">
                {label}
              </Badge>
            ))}
          </Cluster>
        }
        panelFilter={filter}
        panelSidebar={
          selectedNode ? (
            <DetailPanel
              node={selectedNode}
              onClose={() => setSelectedId(null)}
              unlockCmd={unlockCmd}
              unlock={unlockHandlersFor(selectedNode, unlockContext)}
              scienceShown={scienceShown}
              chargesScience={chargesScience}
            />
          ) : undefined
        }
        sections={[
          stats,
          <Section key="graph" fill>
            <FramedDisplay>
              <TechGraph
                nodes={allNodes}
                tiers={tiers}
                researchable={researchable}
                dimmed={(n) => !filter.matches(searchText(n))}
                selectedId={selectedId}
                onSelect={(id) =>
                  setSelectedId((cur) => (cur === id ? null : id))
                }
              />
            </FramedDisplay>
          </Section>,
        ]}
      />
    );
  }

  const sorted = sortNodes(
    allNodes
      .filter((n) => {
        if (listFilter === "researchable") return researchable.has(n.id);
        if (listFilter === "unlocked") return n.state === "Available";
        return true;
      })
      .filter((n) => filter.matches(searchText(n))),
    researchable,
  );

  return (
    <Panel
      panelTitle="TECH TREE"
      compactTitle={["TECH"]}
      panelToolbar={
        <Cluster
          role="group"
          aria-label="Filter tech nodes"
          justify="start"
          gap="related"
          wrap
        >
          <FilterChip
            label="All"
            selected={listFilter === "all"}
            onToggle={() => setListFilter("all")}
          />
          <FilterChip
            label="Researchable"
            selected={listFilter === "researchable"}
            onToggle={() => setListFilter("researchable")}
          />
          <FilterChip
            label="Unlocked"
            selected={listFilter === "unlocked"}
            onToggle={() => setListFilter("unlocked")}
          />
        </Cluster>
      }
      panelFilter={filter}
      sections={[
        stats,
        <Section key="nodes" full>
          {sorted.length === 0 ? (
            <EmptyState>No nodes match</EmptyState>
          ) : (
            <Stack as="ul">
              {sorted.map((n) => (
                <NodeRow
                  key={n.id}
                  node={n}
                  display={displayState(n, researchable)}
                  expanded={expandedId === n.id}
                  onToggleExpand={() =>
                    setExpandedId((current) => (current === n.id ? null : n.id))
                  }
                  unlockCmd={unlockCmd}
                  unlock={unlockHandlersFor(n, unlockContext)}
                  scienceShown={scienceShown}
                  chargesScience={chargesScience}
                />
              ))}
            </Stack>
          )}
        </Section>,
      ]}
    />
  );
}
