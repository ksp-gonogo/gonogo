import {
  BroadcastIcon,
  Button,
  Fab,
  StatusIndicator,
  useModal,
} from "@ksp-gonogo/ui";
import { Cluster, NULL_DISPLAY, Stack } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import type { ConnStatus } from "../peer/PeerClientService";

interface Props {
  hostId: string | null;
  connStatus: ConnStatus;
  /** Goes back to the join page for this code, to pick the other seat. */
  onChangeSeat: () => void;
  /** Leaves the game. */
  onLeave: () => void;
  bottom: number;
}

/**
 * A joined station's Connection button: the code it joined with, whether its
 * link to the host is up, and the way back to the seats or out of the game.
 */
export function StationConnectionFab(props: Props) {
  const { open } = useModal();
  const handleClick = () => {
    open(<StationConnectionPanel {...props} />, { title: "Connection" });
  };
  return (
    <Fab bottom={props.bottom} onClick={handleClick} aria-label="Connection">
      <BroadcastIcon />
    </Fab>
  );
}

function StationConnectionPanel({
  hostId,
  connStatus,
  onChangeSeat,
  onLeave,
}: Props) {
  return (
    <Wrap>
      <Cluster>
        <Label>Join code</Label>
        <Code>{hostId ?? NULL_DISPLAY}</Code>
      </Cluster>
      <Cluster>
        <Label>Status</Label>
        <StatusIndicator tone={statusTone(connStatus)} live>
          {statusLabel(connStatus)}
        </StatusIndicator>
      </Cluster>
      <SeparatedSection>
        <Cluster>
          <Button type="button" onClick={onChangeSeat}>
            Change seat
          </Button>
          <Button variant="ghost" type="button" onClick={onLeave}>
            Leave
          </Button>
        </Cluster>
      </SeparatedSection>
    </Wrap>
  );
}

function statusTone(status: ConnStatus): "go" | "warn" | "nogo" | "info" {
  if (status === "connected") return "go";
  if (status === "connecting" || status === "reconnecting") return "warn";
  if (status === "disconnected") return "nogo";
  return "info";
}

function statusLabel(status: ConnStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting...";
    case "reconnecting":
      return "Reconnecting...";
    case "disconnected":
      return "Disconnected";
    default:
      return "Idle";
  }
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  min-width: 260px;
  color: var(--color-text-primary);
`;

// The flex column comes from the kit; only the separator rule is local.
const SeparatedSection = styled(Stack).attrs({
  gap: "related-comfortable" as const,
})`
  border-top: 1px solid var(--color-border-subtle);
  padding-top: var(--gap-popover-section);
`;

const Label = styled.span`
  font-size: var(--font-size-caption);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const Code = styled.code`
  color: var(--color-info-text);
  /* Display tier: the type scale stops at --font-size-lg on purpose,
     everything above 16px in this codebase is a clamp, a JS fit, or locked
     to a box width. */
  font-size: 18px;
  letter-spacing: 0.12em;
`;
