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
import read from "./tech-tree.declarations.g";
import { parseTechNodes } from "./wire";

export type { TechNode, TechNodeState, TechPart } from "./wire";
export { parseTechNodes } from "./wire";

const topics = defineTopicManifest({
  channels: ["career.status"],
  optionalChannels: read.optionalChannels,
  fields: [
    "career.status.tech.nodes",
    "career.status.tech.unlockedCount",
    "career.status.tech.unlockedIds",
    "career.status.balances.science",
  ],
});

type TechTreeConfig = Record<string, never>;

/**
 * Resolves career telemetry into the typed shape the view renders, then hands off.
 * One record, two currency decisions. The node list is a fact (nobody can spend down a link that is not delivering), so a held tree is still the tree.
 * The science balance feeds the price readout's `canAfford`, a claim about now, so only a current balance colours it. Whether Unlock is available is the command's per-node gate.
 */
function TechTreeComponent({ w }: Readonly<ComponentProps<TechTreeConfig>>) {
  const career = topics.useTelemetry("career.status");
  const tech = stillTrue(career, undefined)?.tech;
  /*
   * A node that never says whether it is unlocked is still unlocked when the
   * mod lists its id: that list is built from loaded parts, so it only ever
   * confirms a node and never refutes one.
   */
  const confirmed = new Set(tech?.unlockedIds ?? []);
  const nodesRaw = tech?.nodes?.map((n) =>
    n.unlocked == null && n.id != null && confirmed.has(n.id)
      ? { ...n, unlocked: true }
      : n,
  );
  const careerScience =
    career.state === "observed" ? career.value.balances?.science : undefined;
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
      allNodes={allNodes}
      unlockedCount={tech?.unlockedCount ?? null}
      sciAvailable={sciAvailable}
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
      value: readingOf(career, (c) => {
        const science = c.balances?.science;
        const nodes = parseTechNodes(c.tech?.nodes) ?? [];
        const reachable = computeResearchable(nodes);
        // The tile counts what the balance can buy now, so a reachable node it cannot pay for is left out.
        const affordable = nodes.filter(
          (n) =>
            reachable.has(n.id) &&
            (science == null ||
              n.scienceCost === null ||
              science.compare(n.scienceCost) >= 0),
        );
        return value("count", affordable.length);
      }),
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
    "Browse and research career tech. From 10 grid units wide it draws the tech tree as the game does, coloured by what you own, can research and cannot reach yet; narrower, it becomes a searchable list with every part each node unlocks.",
  tags: ["career", "tech"],
  defaultSize: { w: 6, h: 9 },
  // Three columns and rows hold the two essentials the tiny form draws.
  minSize: { w: 5, h: 4 },
  component: TechTreeComponent,
  tiny: { title: "TECH", useEssentials: useTechTreeEssentials },
  channels: topics.channels,
  ...read,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  augmentSlots: ["tech-tree.sections"],
  pushable: true,
  requires: ["career"],
});

export { TechTreeComponent };
