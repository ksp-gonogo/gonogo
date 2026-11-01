import { hasHost } from "@ksp-gonogo/sitrep-sdk";
import { useCountdown } from "./CommandDelay/InFlightList";
import { Countdown } from "./Countdown";
import { Text } from "./Text";

/**
 * The wording shown in place of a missing figure while the vessel's first link report is still on its way to the command centre.
 * Useful for giving the operator one phrase for that state on every widget that waits for the first report.
 * Used by {@link AwaitingSignal} and by the widget frame of the dashboard.
 *
 * @category EmptyState
 */
export const AWAITING_FIRST_SIGNAL = "Awaiting first signal";

/**
 * Props for {@link AwaitingSignal}.
 * Useful for giving the notice the time the first report is expected in.
 * Used by {@link AwaitingSignal}.
 *
 * @category EmptyState
 */
export interface AwaitingSignalProps {
  /**
   * How long from mounting until the first report is expected, in seconds: the
   * one-way signal delay between the vessel and the command centre, when it is
   * known. Omit it, or pass `null`, when no delay has been reported, and the
   * notice carries no time.
   */
  expectedIn?: number | null;
}

/**
 * The notice that a link or comms report has not arrived yet, because the
 * vessel's first report is still crossing the distance to the command centre.
 * Useful for showing the operator that the link is not lost and not unknown,
 * only not heard from yet, with the time left until the report is due when the
 * delay is known. Used by Comm Signal and the signal delay readout.
 *
 * The time counts down in game time from the moment the notice mounts, so it
 * stands still while the game is paused and falls at the warp rate under time
 * warp. It is dropped once it reaches zero, so a late report is not shown as a
 * promise.
 *
 * @category EmptyState
 */
export function AwaitingSignal({ expectedIn }: AwaitingSignalProps) {
  const total = expectedIn ?? 0;
  const counting = Number.isFinite(total) && total > 0;
  return (
    <>
      {AWAITING_FIRST_SIGNAL}
      {counting && hasHost() && <ClockedRemaining total={total} />}
    </>
  );
}

/** The time left, counted down on the game clock the host provides. With no host there is no game clock, and no time is drawn. */
function ClockedRemaining({ total }: { total: number }) {
  return <Remaining seconds={useCountdown(total) ?? 0} />;
}

function Remaining({ seconds }: { seconds: number }) {
  if (!(seconds > 0)) return null;
  return (
    <>
      {" "}
      <Text level="muted">
        <Countdown value={Math.ceil(seconds)} />
      </Text>
    </>
  );
}
