import type { Finding } from "../types";
import { checkLoadable, LOADABLE_GROUP } from "./loadable";

/**
 * A group that runs a process rather than reading the client's source: a bare
 * `node` import, a browser. Each costs seconds or needs something installed, so
 * a probe group runs only when `--only` names it.
 */
export interface Probe {
  group: string;
  run(clientDir: string): Promise<Finding[]>;
}

const MINSIZE_GROUP = "minsize";

export const PROBES: readonly Probe[] = [
  { group: LOADABLE_GROUP, run: async (dir) => checkLoadable(dir) },
  {
    group: MINSIZE_GROUP,
    // Imported when asked for: it loads the render harness.
    run: async (dir) => (await import("./minsize")).checkMinSize(dir),
  },
];

export const PROBE_GROUPS: readonly string[] = PROBES.map((p) => p.group);
