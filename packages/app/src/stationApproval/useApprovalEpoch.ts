import { useEffect, useState } from "react";
import type { PeerClientService } from "../peer/PeerClientService";

type Client = Pick<PeerClientService, "getApproval" | "onApprovalChange">;

/**
 * A number that grows each time the main screen approves this station after
 * it had to wait. A subtree keyed on it remounts at that moment, so whatever
 * it asked for once while waiting, and had refused, it asks for again. A
 * station that was approved before it joined never waits, so it never
 * remounts.
 */
export function useApprovalEpoch(client: Client): number {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let previous = client.getApproval();
    return client.onApprovalChange((next) => {
      if (previous === "pending" && next === "approved") {
        setEpoch((n) => n + 1);
      }
      previous = next;
    });
  }, [client]);
  return epoch;
}
