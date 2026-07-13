import { BannerPill } from "@ksp-gonogo/ui";
import { useEffect, useState } from "react";
import type { ConnStatus, PeerClientService } from "./PeerClientService";

interface Props {
  client: PeerClientService;
}

/**
 * Shows a banner when the station's link to the host degrades after the
 * dashboard has mounted. The pre-connect screen already surfaces the
 * disconnect via its `describeConnStatus` copy, but once we're past it
 * (the dashboard renders only when connStatus has been "connected" at
 * least once) there was no affordance to tell the operator the host
 * went away — they'd just see telemetry freeze.
 *
 * Renders nothing while connected. On "reconnecting" shows a warning
 * pill; on "disconnected" escalates to a nogo pill. The banner clears
 * the moment connStatus flips back to "connected".
 */
export function HostDisconnectBanner({ client }: Props) {
  const [status, setStatus] = useState<ConnStatus>("connected");

  useEffect(() => {
    return client.onConnectionStatus((next) => {
      setStatus(next);
    });
  }, [client]);

  if (status === "connected" || status === "idle" || status === "connecting") {
    return null;
  }

  const reconnecting = status === "reconnecting";
  return (
    <BannerPill
      accent={
        reconnecting
          ? "var(--color-status-warning-bg)"
          : "var(--color-status-nogo-bg)"
      }
      pulse={reconnecting}
      role={reconnecting ? "status" : "alert"}
    >
      {reconnecting ? "RECONNECTING TO HOST..." : "HOST DISCONNECTED"}
    </BannerPill>
  );
}
