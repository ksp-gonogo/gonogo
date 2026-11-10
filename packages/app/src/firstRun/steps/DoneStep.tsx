import { Stack, Text } from "@ksp-gonogo/ui-kit";
import { SEAT_TEXT, SeatCard, SeatCardList } from "../../screens/SeatCards";
import type { StartSeat } from "../../screens/seatChoice";
import { say } from "../copy";

/**
 * Closes the flow by saying what to do next, then offers the two seats this
 * screen can start at, as the same cards the join page offers a visitor.
 */
export function DoneStep({
  onStart,
  disabled,
}: {
  onStart: (seat: StartSeat) => void;
  disabled: boolean;
}) {
  return (
    <Stack gap="related-comfortable">
      <Text level="muted" size="sm">
        {say("done.next")}
      </Text>
      <SeatCardList>
        <SeatCard
          title={say("done.startMain")}
          disabled={disabled}
          onChoose={() => onStart("main")}
        >
          <span>{`${say("done.mainScreen")} ${SEAT_TEXT.commandCentre}`}</span>
          <span>{say("done.hosts")}</span>
        </SeatCard>
        <SeatCard
          title={say("done.startPilot")}
          disabled={disabled}
          onChoose={() => onStart("pilot")}
        >
          <span>{SEAT_TEXT.pilot}</span>
          <span>{say("done.hosts")}</span>
        </SeatCard>
      </SeatCardList>
    </Stack>
  );
}
