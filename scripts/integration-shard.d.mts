export function classWeights(
  dir?: string,
  measured?: Record<string, number>,
): Map<string, number>;
export function partition(
  weights: Map<string, number>,
  shards: number,
): string[][];
export function filterFor(classes: string[]): string;
export function claimants(testName: string, shardClasses: string[][]): number[];
