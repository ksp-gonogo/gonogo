import { BannerPill, Button } from "@ksp-gonogo/ui";
import { useEffect, useState } from "react";
import type { PeerClientService } from "../peer/PeerClientService";

type Client = Pick<
  PeerClientService,
  "getApproval" | "onApprovalChange" | "askAgain"
>;

/**
 * Tells a station's operator that the main screen has not approved this
 * station yet, so its commands are refused while it reads, or that the main
 * screen refused it, with the control that asks again. Renders nothing once
 * approved.
 */
export function StationApprovalNotice({ client }: { client: Client }) {
  const [approval, setApproval] = useState(() => client.getApproval());

  useEffect(() => {
    setApproval(client.getApproval());
    return client.onApprovalChange(setApproval);
  }, [client]);

  if (approval === "pending") {
    return (
      <BannerPill accent="var(--color-warn-mark)" anchor="top" role="status">
        <span>Waiting for the main screen to approve this station</span>
      </BannerPill>
    );
  }
  if (approval === "refused") {
    return (
      <BannerPill
        accent="var(--color-nogo-mark)"
        anchor="top"
        interactive
        role="status"
      >
        <span>The main screen refused this station</span>
        <Button onClick={() => client.askAgain()}>Ask again</Button>
      </BannerPill>
    );
  }
  return null;
}
