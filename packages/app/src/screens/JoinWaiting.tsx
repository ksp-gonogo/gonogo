import { Button, Spinner } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { StationNameEditor, useStationNameOptional } from "../stationIdentity";
import { JoinBox, JoinCode, JoinLayout, JoinMuted } from "./joinParts";
import { joinPath, setJoined } from "./seatChoice";

/**
 * A joining screen before the host has let it in: reaching the host, waiting
 * for its approval, or refused. It names this screen as the host sees it in
 * the request, lets the joiner rename it, and offers the way back to the two seats.
 */
export function JoinWaiting({
  code,
  phase,
  onAskAgain,
}: {
  code: string;
  phase: "reaching" | "pending" | "refused";
  onAskAgain?: () => void;
}) {
  const name = useStationNameOptional();
  return (
    <JoinLayout aria-label="Joining a game">
      <JoinBox>
        <h1>
          Join <JoinCode>{code}</JoinCode>
        </h1>
        <Status role="status" aria-live="polite">
          {phase !== "refused" && <Spinner size={16} />}
          <span>
            {phase === "reaching"
              ? "Reaching the host"
              : phase === "pending"
                ? "Waiting for the host to approve this screen"
                : "The host refused this screen"}
          </span>
        </Status>
        {name && (
          <Fact>
            <JoinMuted>Shown to the host as</JoinMuted>
            <StationNameEditor bare />
          </Fact>
        )}
        <Actions>
          {phase === "refused" && onAskAgain && (
            <Button variant="primary" onClick={onAskAgain}>
              Ask again
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setJoined(null);
              globalThis.location.assign(joinPath(code));
            }}
          >
            Choose another seat
          </Button>
        </Actions>
      </JoinBox>
    </JoinLayout>
  );
}

const Status = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  font-size: var(--font-size-base);
`;

const Fact = styled.div`
  display: flex;
  align-items: baseline;
  gap: var(--gap-related);
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-related);
`;
