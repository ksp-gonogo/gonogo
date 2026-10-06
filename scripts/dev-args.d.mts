export const DEV_USAGE: string;
export function parseDevArgs(
  argv: readonly string[],
  cwd: string,
): { uplinks: string[] } | { help: string } | { error: string };
