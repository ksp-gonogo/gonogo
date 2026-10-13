import { BannerPill, Button } from "@ksp-gonogo/ui";
import { useEffect, useState } from "react";
import type { PeerClientService } from "../peer/PeerClientService";

type Client = Pick<
  PeerClientService,
  "isSuperseded" | "onSuperseded" | "takeBack"
>;

/**
 * Says that this station has been opened in another tab, which now holds its
 * connection to the main screen, and offers the one control that takes it
 * back. A station identity holds one live connection, so this page stays
 * disconnected until the operator presses it. Renders nothing otherwise.
 */
export function StationSupersededNotice({ client }: { client: Client }) {
  const [superseded, setSuperseded] = useState(() => client.isSuperseded());

  useEffect(() => {
    setSuperseded(client.isSuperseded());
    return client.onSuperseded(setSuperseded);
  }, [client]);

  if (!superseded) return null;

  return (
    <BannerPill accent="var(--color-warn-mark)" anchor="top" interactive>
      <span>This station is open in another tab</span>
      <Button onClick={() => client.takeBack()}>Use this tab</Button>
    </BannerPill>
  );
}
