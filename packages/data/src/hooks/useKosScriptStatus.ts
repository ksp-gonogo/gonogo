import { getDataSource } from "@gonogo/core";
import { useEffect, useState } from "react";

/**
 * Topic-state shape exposed by the centralised kOS compute fanout. Mirrors
 * `KosTopicStatus` in `@gonogo/app` — duplicated here so widgets can pull
 * the type without importing from the app package (which would be the
 * wrong dependency direction). The shape is intentionally small and
 * stable; if it ever needs richer fields, lift the type into core.
 */
export interface KosScriptStatus {
  /** Most recent successful run (Date.now() ms), or null. */
  lastGoodAt: number | null;
  /** Most recent error from the dispatch (rejection, timeout, kOS error). */
  scriptError: Error | null;
  /** Most recent JSON-parse error on a registered field. */
  parseError: Error | null;
  /** Breaker is open; loop is paused. */
  paused: boolean;
  /** A dispatch is currently in flight. */
  running: boolean;
}

const EMPTY: KosScriptStatus = {
  lastGoodAt: null,
  scriptError: null,
  parseError: null,
  paused: false,
  running: false,
};

interface KosStatusSource {
  getTopicStatus(id: string): KosScriptStatus | null;
  onTopicStatusChange(id: string, cb: () => void): () => void;
}

function isStatusSource(source: unknown): source is KosStatusSource {
  if (source === null || typeof source !== "object") return false;
  const s = source as Partial<KosStatusSource>;
  return (
    typeof s.getTopicStatus === "function" &&
    typeof s.onTopicStatusChange === "function"
  );
}

/**
 * Subscribe to a centralised kOS compute topic's status — the bits
 * `useDataValue` can't carry: lastGoodAt, scriptError, parseError,
 * paused, running. Returns a stable object shape so widgets can render
 * loading / error / paused chrome without juggling separate hooks.
 *
 * Returns the empty status shape if the data source isn't registered yet,
 * or if it doesn't implement the topic-status API (e.g. station-side
 * `PeerClientDataSource` — to be wired up in a later step).
 */
export function useKosScriptStatus(
  topicId: string,
  sourceId = "kos",
): KosScriptStatus {
  const [status, setStatus] = useState<KosScriptStatus>(() => {
    const source = getDataSource(sourceId);
    if (!isStatusSource(source)) return EMPTY;
    return source.getTopicStatus(topicId) ?? EMPTY;
  });

  useEffect(() => {
    const source = getDataSource(sourceId);
    if (!isStatusSource(source)) return;
    const refresh = () => {
      const next = source.getTopicStatus(topicId) ?? EMPTY;
      setStatus(next);
    };
    refresh();
    return source.onTopicStatusChange(topicId, refresh);
  }, [topicId, sourceId]);

  return status;
}
