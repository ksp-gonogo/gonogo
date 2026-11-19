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
export function rangeForUnreleased(cwd?: string): string;
export function plainSections(markdown: string): string;
export function buildChangelog(options: {
  range?: string;
  table?: import("./release-reword.mjs").RewordTable;
  cwd?: string;
  config?: string;
}): string;
