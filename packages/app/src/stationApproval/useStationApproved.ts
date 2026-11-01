import { useEffect, useState } from "react";
import { usePeerClient } from "../peer/PeerClientContext";

/**
 * Whether the main screen lets this station act, as it last said. False on a
 * station the main screen has not approved or has refused; true on the main
 * screen, which has no approval to wait for, and before the main screen has
 * said either way. Used by the GO/NO-GO controls and the mission banner.
 */
export function useStationApproved(): boolean {
  const client = usePeerClient();
  const [approval, setApproval] = useState(() => client?.getApproval());
  useEffect(() => {
    if (!client) return;
    setApproval(client.getApproval());
    return client.onApprovalChange(setApproval);
  }, [client]);
  return approval !== "pending" && approval !== "refused";
}
