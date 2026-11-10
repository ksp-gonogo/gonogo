import { Button, Tag } from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import styled from "styled-components";
import { useHostRecord } from "../hosting/HostRoleContext";
import { peerHostService } from "../peer/PeerHostService";
import {
  Empty,
  RowDesc,
  RowLabel,
  RowText,
  SettingLine,
} from "../settings/settingsLayout";

type Host = Pick<typeof peerHostService, "removeApprovedStation"> &
  Partial<Pick<typeof peerHostService, "approvedSeat" | "onSeatsChange">>;

const SEAT_LABEL = { station: "Station", pilot: "Pilot" } as const;

const approvedOn = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * The screens the game has approved, stations and pilots, each with its seat
 * where this browser has seen it join, and Remove. A removed screen is
 * disconnected, and is asked about again the next time it joins.
 */
export function ApprovedStations({ host = peerHostService }: { host?: Host }) {
  const approved = useHostRecord()?.stations ?? [];
  const [, setSeatsSeen] = useState(0);
  useEffect(
    () => host.onSeatsChange?.(() => setSeatsSeen((n) => n + 1)),
    [host],
  );

  if (approved.length === 0) {
    return <Empty>No screens approved yet</Empty>;
  }

  return (
    <>
      {approved.map((station) => {
        const seat = host.approvedSeat?.(station.id);
        return (
          <SettingLine key={station.id}>
            <RowText>
              <NameRow>
                <RowLabel>{station.name}</RowLabel>
                {seat && <Tag label={SEAT_LABEL[seat]} />}
              </NameRow>
              <RowDesc>
                Approved {approvedOn.format(new Date(station.approvedAt))}
              </RowDesc>
            </RowText>
            <Button
              onClick={() => host.removeApprovedStation(station.id)}
              aria-label={`Remove ${seat ? `${seat} ` : ""}${station.name}`}
            >
              Remove
            </Button>
          </SettingLine>
        );
      })}
    </>
  );
}

const NameRow = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--gap-related);
`;
