import { BannerPill, Button } from "@ksp-gonogo/ui";
import { useEffect, useState } from "react";
import type { PeerHostService, PendingStation } from "../peer/PeerHostService";

type Host = Pick<
  PeerHostService,
  | "pendingStations"
  | "onPendingStationsChange"
  | "approveStation"
  | "refuseStation"
>;

/**
 * How a waiting station is named on the request: its name with the code the
 * station shows on its own screen, so devices sharing a name can be told apart.
 * The word "Station" is added only when the name does not already start with it.
 */
export function stationLabel(station: PendingStation): string {
  const named = `Station ${station.name.replace(/^station\s+/i, "")}`;
  return station.tag ? `${named} (${station.tag})` : named;
}

/**
 * Asks the main screen operator to approve each station that joins with the
 * share code, by the station's name and its code. Until approved, a station reads
 * telemetry but every command, flight request and Uplink call it sends is
 * refused. Approval is remembered, so a station is asked about once; Refuse
 * disconnects it. Renders nothing while no station is waiting.
 */
export function StationApprovalPrompt({ host }: { host: Host }) {
  const [pending, setPending] = useState<readonly PendingStation[]>(() =>
    host.pendingStations(),
  );

  useEffect(() => {
    setPending(host.pendingStations());
    return host.onPendingStationsChange(setPending);
  }, [host]);

  return (
    <>
      {pending.map((station) => (
        <BannerPill
          key={station.peerId}
          accent="var(--color-warn-mark)"
          interactive
          role="status"
        >
          <span>{stationLabel(station)} wants to join</span>
          <Button
            onClick={() => host.approveStation(station.peerId)}
            aria-label={`Approve ${stationLabel(station).replace(/^Station/, "station")}`}
          >
            Approve
          </Button>
          <Button
            onClick={() => host.refuseStation(station.peerId)}
            aria-label={`Refuse ${stationLabel(station).replace(/^Station/, "station")}`}
          >
            Refuse
          </Button>
        </BannerPill>
      ))}
    </>
  );
}
