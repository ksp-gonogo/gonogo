import { useEffect, useSyncExternalStore } from "react";
import type { PeerHostService } from "../peer/PeerHostService";
import {
  type RunningUplink,
  runningUplinks,
  subscribeUplinkOutcomes,
} from "./loaderState";

/* `runningUplinks` builds a new array on every call, so the snapshot keeps the last one while its contents match. */
let lastKey = "";
let lastSet: RunningUplink[] | null = null;
function runningSnapshot(): RunningUplink[] | null {
  const set = runningUplinks();
  const key = JSON.stringify(set);
  if (key !== lastKey) {
    lastKey = key;
    lastSet = set;
  }
  return lastSet;
}

/**
 * Tells the peer mesh which Uplinks this screen runs, by id and version, so
 * every station loads exactly the same set.
 */
export function HostUplinksAnnouncer({
  host,
}: {
  host: Pick<PeerHostService, "setRunningUplinks">;
}) {
  const running = useSyncExternalStore(
    subscribeUplinkOutcomes,
    runningSnapshot,
  );
  useEffect(() => {
    host.setRunningUplinks(running);
  }, [host, running]);
  return null;
}
