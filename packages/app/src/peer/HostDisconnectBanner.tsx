import { BannerPill } from "@ksp-gonogo/ui";
import { useEffect, useState } from "react";
import type { ConnStatus, PeerClientService } from "./PeerClientService";

interface Props {
  client: Pick<PeerClientService, "onConnectionStatus">;
}

/**
 * Shows a banner when the station's link to the host degrades after the
 * dashboard has mounted. The pre-connect screen already surfaces the
 * disconnect via its `describeConnStatus` copy, but once we're past it
 * (the dashboard renders only when connStatus has been "connected" at
 * least once) there was no affordance to tell the operator the host
 * went away: they'd just see telemetry freeze.
 *
 * Renders nothing while connected. On "disconnected" it shows a nogo pill;
 * in every other state, including the "connecting" and "idle" the retry loop
 * passes through between attempts, a warning pill. The banner clears the
 * moment connStatus flips back to "connected".
 */
export function HostDisconnectBanner({ client }: Props) {
  const [status, setStatus] = useState<ConnStatus>("connected");

  useEffect(() => {
    return client.onConnectionStatus((next) => {
      setStatus(next);
    });
  }, [client]);

  if (status === "connected") return null;

  const reconnecting = status !== "disconnected";
  return (
    <BannerPill
      accent={
        reconnecting ? "var(--color-warn-mark)" : "var(--color-nogo-mark)"
      }
      pulse={reconnecting}
      role={reconnecting ? "status" : "alert"}
    >
      {reconnecting ? "RECONNECTING TO HOST..." : "HOST DISCONNECTED"}
    </BannerPill>
  );
}
