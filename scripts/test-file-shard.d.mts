export const SECONDS_PER_UNMEASURED_FILE: number;
export function listTestFiles(dir: string): string[];
export function partitionFiles(
  files: string[],
  weights: Record<string, number>,
  shards: number,
): string[][];
export function measuredWeights(): Record<string, number>;
export function filesForShard(
  dir: string,
  index: number,
  count: number,
): string[];
