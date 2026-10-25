import { BannerPill, Button } from "@ksp-gonogo/ui";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { PeerHostService, PendingStation } from "../peer/PeerHostService";

type Host = Pick<
  PeerHostService,
  | "pendingStations"
  | "onPendingStationsChange"
  | "approveStation"
  | "refuseStation"
>;

/**
 * How a waiting station is named on the request: its name, with the word
 * "Station" added only when the name does not already start with it.
 */
export function stationLabel(station: PendingStation): string {
  return `Station ${station.name.replace(/^station\s+/i, "")}`;
}

/*
 * The Add station panel carries its own copy of the prompt, because the modal's
 * overlay covers the banner strip. The banner copy stays mounted behind the
 * overlay with the same button names, so it steps aside while a panel copy is
 * showing and the operator is left one control that can be pressed.
 */
let panelCopies = 0;
const panelListeners = new Set<() => void>();

function setPanelCopies(next: number): void {
  panelCopies = next;
  for (const cb of panelListeners) cb();
}

function subscribePanelCopies(cb: () => void): () => void {
  panelListeners.add(cb);
  return () => {
    panelListeners.delete(cb);
  };
}

/**
 * Asks the main screen operator to approve each station that joins with the
 * share code, by the station's name. Until approved, a station reads
 * telemetry but every command, flight request and Uplink call it sends is
 * refused. Approval is remembered, so a station is asked about once; Refuse
 * disconnects it. Renders nothing while no station is waiting. `inPanel` marks
 * the copy inside the Add station panel, which the banner copy yields to.
 */
export function StationApprovalPrompt({
  host,
  inPanel = false,
}: {
  host: Host;
  inPanel?: boolean;
}) {
  const [pending, setPending] = useState<readonly PendingStation[]>(() =>
    host.pendingStations(),
  );

  useEffect(() => {
    setPending(host.pendingStations());
    return host.onPendingStationsChange(setPending);
  }, [host]);

  useEffect(() => {
    if (!inPanel) return;
    setPanelCopies(panelCopies + 1);
    return () => setPanelCopies(panelCopies - 1);
  }, [inPanel]);

  const yielded = useSyncExternalStore(
    subscribePanelCopies,
    () => !inPanel && panelCopies > 0,
  );
  if (yielded) return null;

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
