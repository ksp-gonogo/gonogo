export interface TagMove {
  name: string;
  /** Where the tag points now, or `undefined` when the package does not carry it. */
  from: string | undefined;
  to: string;
  needed: boolean;
}

export type Npm = (args: string[]) => unknown;

export const HOLDING_TAG: string;
export const PROBE_TAG: string;
export function nugetLists(index: unknown, version: string): boolean;
export function planMoves(
  tagsByName: Record<string, Record<string, string> | undefined>,
  tag: string,
  version: string,
): TagMove[];
export function restoreCommand(move: TagMove, tag: string): string[];
export function moveTogether(
  moves: readonly TagMove[],
  tag: string,
  npm: Npm,
  log?: (line: string) => void,
): TagMove[];
export function main(argv: string[], options?: { npm?: Npm }): Promise<void>;
