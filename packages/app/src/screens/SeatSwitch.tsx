import { Button, useModal } from "@ksp-gonogo/ui-kit";
import { createContext, type ReactNode, useContext } from "react";
import styled from "styled-components";
import { peerHostService } from "../peer/PeerHostService";
import type { StartSeat } from "./seatChoice";

interface SeatSwitchValue {
  seat: StartSeat;
  switchTo: (seat: StartSeat) => void;
}

const SeatSwitchContext = createContext<SeatSwitchValue | null>(null);

/** Gives the hosting screen's seat switch to the `SeatSwitch` link below it. */
export function SeatSwitchProvider({
  seat,
  switchTo,
  children,
}: SeatSwitchValue & { children: ReactNode }) {
  return (
    <SeatSwitchContext.Provider value={{ seat, switchTo }}>
      {children}
    </SeatSwitchContext.Provider>
  );
}

function stationsLine(count: number): string {
  if (count === 0) return "No stations are connected.";
  return count === 1
    ? "1 station is connected."
    : `${count} stations are connected.`;
}

/**
 * The host screen's link to its other seat, mission control or pilot. It
 * changes where this screen sits and nothing about who hosts, so every joined
 * screen stays connected. Leaving mission control leaves the game with no
 * main screen, so that way asks first and says how many stations are
 * connected. Renders nothing on a screen that does not host.
 */
export function SeatSwitch() {
  const value = useContext(SeatSwitchContext);
  const { open, close } = useModal();
  if (!value) return null;
  const { seat, switchTo } = value;

  if (seat === "pilot") {
    return (
      <Button variant="ghost" size="sm" onClick={() => switchTo("main")}>
        Switch to mission control
      </Button>
    );
  }

  const confirm = () => {
    const stations = peerHostService.seatCounts().stations;
    const id = open(
      <Confirm>
        <p>This game will have no main screen. {stationsLine(stations)}</p>
        <Confirm__Actions>
          <Button variant="ghost" onClick={() => close(id)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              close(id);
              switchTo("pilot");
            }}
          >
            Switch to pilot
          </Button>
        </Confirm__Actions>
      </Confirm>,
      { title: "Switch to pilot" },
    );
  };

  return (
    <Button variant="ghost" size="sm" onClick={confirm}>
      Switch to pilot
    </Button>
  );
}

const Confirm = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  color: var(--color-text-primary);

  p {
    margin: 0;
    font-size: var(--font-size-prose);
    line-height: var(--line-height-prose);
  }
`;

const Confirm__Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: var(--gap-related);
`;
