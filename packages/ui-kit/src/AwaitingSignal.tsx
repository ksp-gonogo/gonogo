import { useEffect, useState } from "react";
import { Countdown } from "./Countdown";
import { Text } from "./Text";

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
 * The time counts down from the moment the notice mounts and is dropped once it
 * reaches zero, so a late report is not shown as a promise.
 *
 * @category EmptyState
 */
export function AwaitingSignal({ expectedIn }: AwaitingSignalProps) {
  const total = expectedIn ?? 0;
  const counting = Number.isFinite(total) && total > 0;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!counting) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000);
    }, 1000);
    return () => clearInterval(id);
  }, [counting]);
  const remaining = counting ? total - elapsed : 0;
  return (
    <>
      Awaiting first signal
      {remaining > 0 && (
        <>
          {" "}
          <Text level="muted">
            <Countdown value={Math.ceil(remaining)} />
          </Text>
        </>
      )}
    </>
  );
}
