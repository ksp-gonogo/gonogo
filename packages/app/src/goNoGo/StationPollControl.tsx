import { useScreen } from "@ksp-gonogo/core";
import {
  type InputMappings,
  InputMappingTab,
  SerialDeviceProvider,
  useSerialDeviceService,
} from "@ksp-gonogo/serial";
import { useModal } from "@ksp-gonogo/ui";
import {
  Button,
  IconButton,
  LiveRegion,
  SettingsIcon,
  Tooltip,
} from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { usePeerClient } from "../peer/PeerClientContext";
import { StationNameEditor } from "../stationIdentity";
import {
  CountdownAnnouncer,
  CountdownLine,
  useSecondsLeft,
} from "./countdownCues";
import { noticeLabel } from "./notice";
import { type StationPoll, useStationPoll } from "./useStationPoll";
import { VOTE_ACTIONS, voteInputs } from "./voteInput";

/**
 * The middle of a station's header: its name, the input binding for its vote,
 * and the vote itself, which becomes ABORT once the craft has lifted off.
 * Holds this screen's vote, so it is mounted once per screen.
 */
export function StationPollControl() {
  const poll = useStationPoll(usePeerClient());
  return (
    <Centre role="group" aria-label="GO/NO-GO">
      <StationNameEditor bare />
      <VoteInputButton />
      <PollButtons poll={poll} />
      <PollStatus poll={poll} />
    </Centre>
  );
}

function PollButtons({ poll }: Readonly<{ poll: StationPoll }>) {
  const onGo =
    poll.onGoLabel === undefined
      ? null
      : `On go: ${poll.onGoLabel ?? "Nothing"}`;
  const voteText = poll.inPoll
    ? poll.vote === "go"
      ? "GO"
      : "NO-GO"
    : "NOT IN POLL";
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {poll.voting ? `Vote ${voteText}` : ""}
      </span>
      {poll.voting && (
        <Tooltip text={poll.inPoll ? onGo : null}>
          <Button
            size="sm"
            variant={poll.inPoll && poll.vote === "go" ? "primary" : "default"}
            tone={
              poll.inPoll ? (poll.vote === "go" ? "go" : "nogo") : undefined
            }
            onClick={poll.toggleVote}
            disabled={!poll.inPoll}
            disabledReason={
              poll.inPoll
                ? undefined
                : "The main screen has not approved this station"
            }
          >
            {voteText}
          </Button>
        </Tooltip>
      )}
      {poll.launched && (
        <Button size="sm" variant="primary" tone="nogo" onClick={poll.abort}>
          ABORT
        </Button>
      )}
    </>
  );
}

function PollStatus({ poll }: Readonly<{ poll: StationPoll }>) {
  const secondsLeft = useSecondsLeft(poll.countdownT0);
  return (
    <>
      {secondsLeft !== null && (
        <>
          <CountdownLine
            secondsLeft={secondsLeft}
            action={poll.onGoLabel ?? null}
          />
          <CountdownAnnouncer secondsLeft={secondsLeft} />
        </>
      )}
      <Notice>
        {poll.abortedBy
          ? `Aborted by ${poll.abortedBy}`
          : poll.notice && secondsLeft === null
            ? noticeLabel(poll.notice)
            : ""}
      </Notice>
    </>
  );
}

/**
 * The gear beside the station's name: opens the same input picker a widget's
 * Inputs tab uses, for the key or controller button that flips the vote and
 * the one that aborts. The binding belongs to this screen.
 */
function VoteInputButton() {
  const screen = useScreen();
  const serial = useSerialDeviceService();
  const { open, close } = useModal();
  const handleOpen = () => {
    const id = open(
      <SerialDeviceProvider service={serial}>
        <InputMappingTab
          actions={VOTE_ACTIONS}
          mappings={voteInputs.get(screen)}
          onSave={(next: InputMappings) => {
            voteInputs.set(screen, next);
            close(id);
          }}
          onClose={() => close(id)}
        />
      </SerialDeviceProvider>,
      { title: "Vote input" },
    );
  };
  return (
    <IconButton onClick={handleOpen} aria-label="Vote input">
      <SettingsIcon />
    </IconButton>
  );
}

const Centre = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--gap-related);
  min-width: 0;
`;

/** What the poll last did: why a countdown was held, whether the T-0 action was sent, or who aborted. */
const Notice = styled(LiveRegion)`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  color: var(--color-warn-text);

  &:empty {
    display: none;
  }
`;
