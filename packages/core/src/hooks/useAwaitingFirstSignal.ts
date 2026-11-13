import { useTelemetry } from "./useTelemetry";

/**
 * Whether the command centre this screen stands at has no route to the active
 * craft, as that centre's own `commandCentre.activeVesselDelay` says. Such a
 * centre is sent none of the craft's channels, so its first report never
 * comes.
 */
export function readNoRoute<V extends { noRoute?: boolean }>(
  delays: { state: string; value?: V } | undefined,
): boolean {
  if (delays === undefined) return false;
  if (delays.state !== "observed" && delays.state !== "held") return false;
  return delays.value?.noRoute === true;
}

/** See {@link readNoRoute}. */
export function useNoRouteToCraft(): boolean {
  return readNoRoute(useTelemetry("commandCentre.activeVesselDelay"));
}

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
  const awaiting = isAwaitingFirstSignal(useTelemetry("comms.link"));
  return useNoRouteToCraft() ? false : awaiting;
}
