export const STATUS_CONTEXT: string;
export function failingWidgets(log: string): string[];
export function widgetDirs(ids: string[], dirs: string[]): string[];
export function search<T>(
  commits: T[],
  fails: (commit: T) => boolean,
): { culprit: T; steps: number };
