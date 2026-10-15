import { Button } from "@ksp-gonogo/ui-kit";
import { useSyncExternalStore } from "react";
import { peerHostService } from "../peer/PeerHostService";
import { stationApprovals } from "../peer/stationApprovals";
import {
  Empty,
  RowDesc,
  RowLabel,
  RowText,
  SettingLine,
} from "../settings/settingsLayout";

type Host = Pick<typeof peerHostService, "removeApprovedStation">;

const subscribe = (cb: () => void) => stationApprovals.subscribe(cb);
const snapshot = () => stationApprovals.list();

const approvedOn = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * The stations this main screen has approved, each with Remove. A removed
 * station is disconnected, and is asked about again the next time it joins.
 */
export function ApprovedStations({ host = peerHostService }: { host?: Host }) {
  const approved = useSyncExternalStore(subscribe, snapshot, snapshot);

  if (approved.length === 0) {
    return <Empty>No stations approved yet</Empty>;
  }

  return (
    <>
      {approved.map((station) => (
        <SettingLine key={station.credential}>
          <RowText>
            <RowLabel>{station.name}</RowLabel>
            <RowDesc>
              Approved {approvedOn.format(new Date(station.approvedAt))}
            </RowDesc>
          </RowText>
          <Button
            onClick={() => host.removeApprovedStation(station.credential)}
            aria-label={`Remove station ${station.name}`}
          >
            Remove
          </Button>
        </SettingLine>
      ))}
    </>
  );
}
