import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useGameContext,
} from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import {
  readingOf,
  stillTrue,
  type TinyEssential,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "../shared/magnitude";
import { computeResearchable } from "./graph-layout";
import { TechTreeView } from "./TechTreeView";
import { parseTechNodes } from "./wire";

export type { TechNode, TechNodeState, TechPart } from "./wire";
export { parseTechNodes } from "./wire";

const topics = defineTopicManifest({
  channels: ["career.status"],
  fields: ["career.status.tech.nodes", "career.status.balances.science"],
});

type TechTreeConfig = Record<string, never>;

/**
 * Resolves career telemetry into the typed shape the view renders, then hands off.
 * One record, two currency decisions. The node list is a fact (nobody can spend down a link that is not delivering), so a held tree is still the tree.
 * The science balance feeds the price readout's `canAfford`, a claim about now, so only a current balance colours it. Whether Unlock is available is the command's per-node gate.
 */
function TechTreeComponent({ w, h }: Readonly<ComponentProps<TechTreeConfig>>) {
  const career = topics.useTelemetry("career.status");
  const nodesRaw = stillTrue(career, undefined)?.tech?.nodes;
  const careerScience =
    career.state === "observed" ? career.value.balances?.science : undefined;
  const careerHeld = career.state === "held";
  // The balance as drawn: a held one stays on screen and Unit marks it.
  const scienceShown = readingOf(
    career,
    (c) => c.balances?.science ?? undefined,
  );
  const { chargesScience } = useGameContext();
  // An R&D-desk action with no vessel signal delay, so it dispatches at the meta-vantage.
  const unlockCmd = useCommand("career.tech.unlock", { vantage: META_VANTAGE });
  // A career model that refuses `career.tech.unlock` (one that researches through a queue of its own) refuses for a reason the balance has no part in, so no affordability verdict is drawn.
  const unlockBlocked = unlockCmd.gate?.blocked === true;

  const allNodes = parseTechNodes(nodesRaw);
  // Unwrapped because the Unlock button compares it against a node's cost.
  const sciAvailable = magnitudeOf(careerScience);

  return (
    <TechTreeView
      w={w}
      h={h}
      allNodes={allNodes}
      sciAvailable={sciAvailable}
      science={careerScience}
      careerHeld={careerHeld}
      scienceShown={scienceShown}
      chargesScience={chargesScience}
      unlockCmd={unlockCmd}
      unlockBlocked={unlockBlocked}
    />
  );
}

/** How many nodes the balance can buy now, and the balance. */
function useTechTreeEssentials(): readonly TinyEssential[] {
  const career = topics.useTelemetry("career.status");
  return [
    {
      label: "Researchable",
      value: readingOf(career, (c) =>
        value(
          "count",
          computeResearchable(
            parseTechNodes(c.tech?.nodes) ?? [],
            c.balances?.science,
          ).size,
        ),
      ),
    },
    {
      label: "Science",
      value: readingOf(career, (c) => c.balances?.science ?? undefined),
      decimals: 0,
    },
  ];
}

registerComponent<TechTreeConfig>({
  id: "tech-tree",
  name: "Tech Tree",
  description:
    "Browse and unlock career-mode tech nodes. At wide sizes it renders the in-game-style tiered dependency graph (columns by longest-path depth, connectors from each parent to its children, colour-coded owned / researchable / locked); at narrow sizes it falls back to a filterable, searchable list with the full part manifest per node.",
  tags: ["career", "tech"],
  defaultSize: { w: 6, h: 9 },
  // Three columns and rows hold the two essentials the tiny form draws.
  minSize: { w: 3, h: 3 },
  component: TechTreeComponent,
  tiny: { title: "TECH", useEssentials: useTechTreeEssentials },
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["career"],
});

export { TechTreeComponent };
