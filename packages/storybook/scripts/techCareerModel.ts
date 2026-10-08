/** One node of the tree as `career.status.tech.nodes` carries it. */
export interface CareerNode {
  id: string;
  title: string;
  description?: string;
  scienceCost: number;
  unlocked: boolean;
  parents: string[];
}

/** The career at one step: what was earned, what was bought, what is left. */
export interface CareerFrame {
  step: number;
  /** Science that arrived on this frame, 0 on a purchase and on the first frame. */
  earned: number;
  science: number;
  ownedIds: string[];
  /** The node bought this step, if any. */
  bought: CareerNode | null;
  /** Nodes the balance could buy right now, after this step's purchase. */
  researchable: number;
}

/** Science handed in by one flight after another, in the order it came back. */
export const SCIENCE_RETURNS = [
  8, 6, 14, 12, 20, 18, 30, 26, 40, 34, 55, 48, 70, 64, 95, 85, 120, 110,
] as const;

function canBuy(
  node: CareerNode,
  owned: ReadonlySet<string>,
  science: number,
): boolean {
  return (
    !owned.has(node.id) &&
    node.scienceCost <= science &&
    node.parents.every((p) => owned.has(p))
  );
}

/**
 * A career from an empty tree. A flight returns science, and that is a frame of
 * its own with the balance risen and the reachable nodes lit; the next frame is
 * the player buying the cheapest of them, when there is one.
 */
export function playCareer(
  tree: readonly CareerNode[],
  returns: readonly number[] = SCIENCE_RETURNS,
): CareerFrame[] {
  const roots = tree.filter((n) => n.parents.length === 0).map((n) => n.id);
  const owned = new Set<string>(roots);
  let science = 0;
  const frames: CareerFrame[] = [
    {
      step: 0,
      earned: 0,
      science,
      ownedIds: [...owned],
      bought: null,
      researchable: countResearchable(tree, owned, science),
    },
  ];
  for (const earned of returns) {
    science += earned;
    const frame = (bought: CareerNode | null): CareerFrame => ({
      step: frames.length,
      earned: bought ? 0 : earned,
      science,
      ownedIds: [...owned],
      bought,
      researchable: countResearchable(tree, owned, science),
    });
    frames.push(frame(null));
    const pick = tree
      .filter((n) => canBuy(n, owned, science))
      .sort((a, b) => a.scienceCost - b.scienceCost)[0];
    if (pick) {
      owned.add(pick.id);
      science -= pick.scienceCost;
      frames.push(frame(pick));
    }
  }
  return frames;
}

function countResearchable(
  tree: readonly CareerNode[],
  owned: ReadonlySet<string>,
  science: number,
): number {
  return tree.filter((n) => canBuy(n, owned, science)).length;
}

/** The tree as the wire carries it on a frame: ownership set, nothing else moved. */
export function nodesAt(
  tree: readonly CareerNode[],
  frame: CareerFrame,
): CareerNode[] {
  const owned = new Set(frame.ownedIds);
  return tree.map((n) => ({ ...n, unlocked: owned.has(n.id) }));
}
