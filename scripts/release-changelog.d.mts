export function skippedIds(
  commits: { id: string; subject: string; body: string }[],
): Set<string>;
export function capChangelog(
  text: string,
  maxBytes: number,
  link: string,
): string;
export function main(argv: string[]): number;
export function rangeForTag(tag: string, cwd?: string): string;
