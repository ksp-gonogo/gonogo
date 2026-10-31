import { Button } from "@ksp-gonogo/ui-kit";
import { useHostRecord } from "../hosting/HostRoleContext";
import { peerHostService } from "../peer/PeerHostService";
import {
  Empty,
  RowDesc,
  RowLabel,
  RowText,
  SettingLine,
} from "../settings/settingsLayout";

type Host = Pick<typeof peerHostService, "removeApprovedStation">;

const approvedOn = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * The stations the game has approved, each with Remove. A removed station is
 * disconnected, and is asked about again the next time it joins.
 */
export function ApprovedStations({ host = peerHostService }: { host?: Host }) {
  const approved = useHostRecord()?.stations ?? [];

  if (approved.length === 0) {
    return <Empty>No stations approved yet</Empty>;
  }

  return (
    <>
      {approved.map((station) => (
        <SettingLine key={station.id}>
          <RowText>
            <RowLabel>{station.name}</RowLabel>
            <RowDesc>
              Approved {approvedOn.format(new Date(station.approvedAt))}
            </RowDesc>
          </RowText>
          <Button
            onClick={() => host.removeApprovedStation(station.id)}
            aria-label={`Remove station ${station.name}`}
          >
            Remove
          </Button>
        </SettingLine>
      ))}
    </>
  );
}
