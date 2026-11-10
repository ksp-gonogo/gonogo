import { BannerPill, Button } from "@ksp-gonogo/ui";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PeerHostService, PendingStation } from "../peer/PeerHostService";

type Host = Pick<
  PeerHostService,
  | "pendingStations"
  | "onPendingStationsChange"
  | "onPendingStationLeft"
  | "approveStation"
  | "refuseStation"
>;

const LEFT_NOTE_MS = 8000;

function sameStation(a: PendingStation, b: PendingStation): boolean {
  return a.name === b.name;
}

/**
 * How a waiting screen is named on the request. A station is its name, with
 * the word "Station" added only when the name does not already start with it;
 * a pilot is its name, which is "Pilot" until someone renames it.
 */
export function stationLabel(station: PendingStation): string {
  if (station.seat === "pilot") return station.name;
  return `Station ${station.name.replace(/^station\s+/i, "")}`;
}

/** What a waiting screen asks for: to join, and as a pilot when that is its seat. */
function joinRequest(station: PendingStation): string {
  if (station.seat !== "pilot" || /^pilot$/i.test(station.name.trim())) {
    return `${stationLabel(station)} wants to join`;
  }
  return `${station.name} wants to join as a pilot`;
}

/** The request's name in a button's accessible name: "station X" or "pilot X". */
function accessibleName(station: PendingStation): string {
  if (station.seat === "pilot") {
    return /^pilot$/i.test(station.name.trim())
      ? "pilot"
      : `pilot ${station.name}`;
  }
  return stationLabel(station).replace(/^Station/, "station");
}

/*
 * The Invite panel carries its own copy of the prompt, because the modal's
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
 * share code, by the station's name. Until approved, a station
 * reads telemetry but every command, flight request and Uplink call it sends is
 * refused. Approval is remembered, so a station is asked about once; Refuse
 * disconnects it. A station that leaves before an answer is named for a few
 * seconds in place of its request. Renders nothing while none is waiting or has
 * just left. `inPanel` marks the copy inside the Invite panel, which the
 * banner copy yields to.
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
  const [left, setLeft] = useState<readonly PendingStation[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setPending(host.pendingStations());
    const offPending = host.onPendingStationsChange((next) => {
      setPending(next);
      setLeft((was) =>
        was.filter((gone) => !next.some((p) => sameStation(p, gone))),
      );
    });
    const offLeft = host.onPendingStationLeft((station) => {
      setLeft((was) => [
        ...was.filter((g) => !sameStation(g, station)),
        station,
      ]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setLeft((was) => was.filter((g) => g !== station));
      }, LEFT_NOTE_MS);
      timers.current.add(timer);
    });
    const held = timers.current;
    return () => {
      offPending();
      offLeft();
      for (const t of held) clearTimeout(t);
      held.clear();
    };
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
      {left.map((station) => (
        <BannerPill
          key={`left-${station.peerId}`}
          accent="var(--color-warn-mark)"
          role="status"
        >
          <span>{stationLabel(station)} left before it was approved</span>
        </BannerPill>
      ))}
      {pending.map((station) => (
        <BannerPill
          key={station.peerId}
          accent="var(--color-warn-mark)"
          interactive
          role="status"
          actions={
            <>
              <Button
                onClick={() => host.approveStation(station.peerId)}
                aria-label={`Approve ${accessibleName(station)}`}
              >
                Approve
              </Button>
              <Button
                onClick={() => host.refuseStation(station.peerId)}
                aria-label={`Refuse ${accessibleName(station)}`}
              >
                Refuse
              </Button>
            </>
          }
        >
          <span>{joinRequest(station)}</span>
        </BannerPill>
      ))}
    </>
  );
}
