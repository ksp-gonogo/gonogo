import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useGameContext,
} from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import { stillTrue } from "@ksp-gonogo/sitrep-sdk";
import { usePanelDelay } from "@ksp-gonogo/ui-kit";
import { magnitudeOf } from "../shared/magnitude";
import { TechTreeView } from "./TechTreeView";
import { parseTechNodes } from "./wire";

export type { TechNode, TechNodeState, TechPart } from "./wire";
export { parseTechNodes } from "./wire";

const topics = defineTopicManifest({
  channels: ["career.status", "spaceCenter.scene"],
  fields: [
    "career.status.tech.nodes",
    "career.status.economy.science",
    "spaceCenter.scene.scene",
  ],
});

type TechTreeConfig = Record<string, never>;

/**
 * Resolves career telemetry into the typed shape the view renders, then hands off.
 * One record, two currency decisions. The node list is a fact (nobody can spend down a link that is not delivering), so a held tree is still the tree.
 * The science balance feeds `canAfford`, a claim about now that arms a spend, so a stale balance is withheld and every Unlock refuses.
 */
function TechTreeComponent({ w, h }: Readonly<ComponentProps<TechTreeConfig>>) {
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
  // Unwrapped because the Unlock button compares it against a node's cost.
  const sciAvailable = magnitudeOf(careerScience);

  return (
    <TechTreeView
      w={w}
      h={h}
      allNodes={allNodes}
      sciAvailable={sciAvailable}
      careerNotCurrent={careerNotCurrent}
      scene={scene}
      chargesScience={chargesScience}
      unlockCmd={unlockCmd}
      unlockBlocked={unlockBlocked}
    />
  );
}

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
