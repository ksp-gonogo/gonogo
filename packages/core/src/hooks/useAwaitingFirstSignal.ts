import { useTelemetry } from "./useTelemetry";

/**
 * Whether a `comms.link` reading is the vessel's first report still crossing
 * the distance to the command centre: nothing has arrived, the game clock
 * jumped past the last report and the next has not had time to cross, or the
 * game is loading a scene. A link that arrived saying it has nothing is an
 * answer and is not awaited, and neither is a hold with another stated cause
 * (a blackout, a dropped connection, a recorded replay).
 */
export function isAwaitingFirstSignal(link: {
  state: string;
  grade?: string;
}): boolean {
  return (
    link.state === "pending" ||
    (link.state === "held" &&
      (link.grade === "held" || link.grade === "loading"))
  );
}

/**
 * Whether the vessel's link report has not yet reached this command centre.
 * Every widget that draws the awaiting notice decides when with this and
 * nothing else, so the rule is read off one channel everywhere.
 */
export function useAwaitingFirstSignal(): boolean {
  return isAwaitingFirstSignal(useTelemetry("comms.link"));
}
