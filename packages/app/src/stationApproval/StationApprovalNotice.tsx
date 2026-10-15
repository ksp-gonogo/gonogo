import { BannerPill, Button } from "@ksp-gonogo/ui";
import { useEffect, useState } from "react";
import type { PeerClientService } from "../peer/PeerClientService";

type Client = Pick<
  PeerClientService,
  "getApproval" | "onApprovalChange" | "askAgain" | "onWriteRefused"
>;

/** What the operator tried, named the way the screen shows it. */
const REFUSED_LABEL: Record<string, string> = {
  "gonogo-vote": "GO/NO-GO vote",
  "gonogo-abort": "Abort",
  "widget-push": "Widget push",
  "widget-recall": "Widget recall",
  "alarm-add": "Alarm",
  "alarm-update": "Alarm change",
  "alarm-delete": "Alarm deletion",
  "alarm-acknowledge": "Alarm dismissal",
  "alarm-ack-unscheduled-warp": "Warp warning dismissal",
  "alarm-warp-intent": "Warp change",
  "trigger-arm": "Maneuver trigger",
  "trigger-cancel": "Maneuver trigger cancel",
};

/**
 * Tells a station's operator that the main screen has not approved this
 * station yet, so everything it sends is refused while it reads, naming the
 * last thing refused; or that the main screen refused it, with the control
 * that asks again. Renders nothing once approved.
 */
export function StationApprovalNotice({ client }: { client: Client }) {
  const [approval, setApproval] = useState(() => client.getApproval());
  const [lastRefused, setLastRefused] = useState<string | null>(null);

  useEffect(() => {
    setApproval(client.getApproval());
    const offApproval = client.onApprovalChange((next) => {
      setApproval(next);
      if (next !== "pending") setLastRefused(null);
    });
    const offRefused = client.onWriteRefused((refused) =>
      setLastRefused(REFUSED_LABEL[refused] ?? null),
    );
    return () => {
      offApproval();
      offRefused();
    };
  }, [client]);

  if (approval === "pending") {
    return (
      <BannerPill accent="var(--color-warn-mark)" anchor="top" role="status">
        <span>Waiting for the main screen to approve this station</span>
        {lastRefused && <span>{lastRefused} not sent</span>}
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
