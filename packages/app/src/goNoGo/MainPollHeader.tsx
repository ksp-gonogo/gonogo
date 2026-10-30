import { useGameContext } from "@ksp-gonogo/core";
import { LiveRegion } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import {
  CountdownAnnouncer,
  CountdownLine,
  CountdownTone,
  useSecondsLeft,
} from "./countdownCues";
import { useGoNoGoSnapshot } from "./GoNoGoHostContext";
import type { GoNoGoSnapshot, StationSnapshot } from "./GoNoGoHostService";
import { noticeLabel } from "./notice";

type BoxState = "go" | "no-go" | "abort" | "none";

function boxState(s: StationSnapshot, snapshot: GoNoGoSnapshot): BoxState {
  const { launched, reopened, abort } = snapshot;
  if (launched && abort?.peerId === s.peerId) return "abort";
  if (launched && !reopened) return "none";
  if (s.status === "go") return "go";
  if (s.status === "no-go") return "no-go";
  return "none";
}

const BOX_TEXT: Record<BoxState, string> = {
  go: "GO",
  "no-go": "NO-GO",
  abort: "ABORT",
  none: "",
};

/**
 * The middle of the main screen's header in the flight scene: every
 * connected station by name, coloured by its vote, and in their place the
 * countdown once every station in the poll is GO.
 */
export function MainPollHeader() {
  const { inFlight } = useGameContext();
  const snapshot = useGoNoGoSnapshot();
  const secondsLeft = useSecondsLeft(snapshot?.countdown?.t0Ms ?? null);
  if (!inFlight || !snapshot) return null;
  const notice =
    snapshot.notice && secondsLeft === null ? noticeLabel(snapshot.notice) : "";
  return (
    <Centre role="group" aria-label="GO/NO-GO">
      {secondsLeft !== null ? (
        <>
          <CountdownLine
            secondsLeft={secondsLeft}
            action={snapshot.config.onGoLabel}
          />
          <CountdownAnnouncer secondsLeft={secondsLeft} />
          <CountdownTone secondsLeft={secondsLeft} />
        </>
      ) : (
        <Boxes>
          {snapshot.stations.map((s) => {
            const state = boxState(s, snapshot);
            const text = BOX_TEXT[state];
            return (
              <Box
                key={s.peerId}
                $state={state}
                role="status"
                aria-live={state === "abort" ? "assertive" : "polite"}
                aria-label={text ? `${s.name}: ${text}` : s.name}
              >
                <BoxName>{s.name}</BoxName>
                {text && <BoxVote>{text}</BoxVote>}
              </Box>
            );
          })}
        </Boxes>
      )}
      <Notice>{notice}</Notice>
    </Centre>
  );
}

/* A column, so the notice sits under the stations and the stations stay centred. */
const Centre = styled.div`
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-related-dense);
  min-width: 0;
`;

const Boxes = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--gap-related);
  min-width: 0;
`;

const BOX_BORDER: Record<BoxState, string> = {
  go: "var(--color-go-status)",
  "no-go": "var(--color-nogo-mark)",
  abort: "var(--color-nogo-mark)",
  none: "var(--color-border-strong)",
};
const BOX_BG: Record<BoxState, string> = {
  go: "rgba(40, 160, 80, 0.2)",
  "no-go": "rgba(160, 40, 40, 0.2)",
  abort: "rgba(200, 40, 40, 0.4)",
  none: "rgba(50, 50, 50, 0.25)",
};
const BOX_COLOR: Record<BoxState, string> = {
  go: "var(--color-go-text)",
  "no-go": "var(--color-nogo-text)",
  abort: "var(--color-nogo-text)",
  none: "var(--color-text-muted)",
};

const Box = styled.div<{ $state: BoxState }>`
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 6rem;
  max-width: 14rem;
  padding: var(--inset-control-compact);
  border-radius: var(--radius-regular);
  border: 1px solid ${({ $state }) => BOX_BORDER[$state]};
  background: ${({ $state }) => BOX_BG[$state]};
  color: ${({ $state }) => BOX_COLOR[$state]};
  line-height: var(--line-height-flush);
`;

const BoxName = styled.span`
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-caption);
  letter-spacing: 0.08em;
`;

const BoxVote = styled.span`
  font-size: var(--font-size-value);
  font-weight: 700;
  letter-spacing: 0.12em;
`;

/** What the poll last did: why a countdown was held, or whether the T-0 action was sent. */
const Notice = styled(LiveRegion)`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  color: var(--color-warn-text);

  &:empty {
    display: none;
  }
`;
