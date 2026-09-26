import { useEffect, useState } from "react";
import type { CommcastLog } from "./CommcastLog";

/** How many messages this log has dropped at the cap, reactively. */
export function useDroppedCount(log: CommcastLog | null): number {
  const [dropped, setDropped] = useState(
    () => log?.snapshot().droppedCount ?? 0,
  );
  useEffect(() => {
    if (!log) return;
    setDropped(log.snapshot().droppedCount);
    return log.subscribe((snap) => setDropped(snap.droppedCount));
  }, [log]);
  return dropped;
}
