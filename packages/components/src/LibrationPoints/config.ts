import type { ActionDefinition } from "@ksp-gonogo/core";

export interface LibrationPointsConfig {
  /**
   * Which pair, by the secondary body's name (`<parent>-<body>`). `"auto"`,
   * or absent, follows the craft: the pair it is nearest to as a fraction of
   * that pair's own separation.
   */
  pair?: string;
}

export const AUTO_PAIR = "auto";

export const librationPointsActions = [
  {
    id: "cyclePair",
    label: "Cycle Pair",
    accepts: ["button"],
    description: "Step to the next body pair, with Auto in the cycle.",
  },
] as const satisfies readonly ActionDefinition[];

export type LibrationPointsActions = typeof librationPointsActions;
