import { useTelemetry } from "./useTelemetry";

/**
 * Whether a `comms.link` reading is the vessel's first report still crossing
 * the distance to the command centre. A link that arrived saying it has
 * nothing is an answer and is not awaited.
 */
export function isAwaitingFirstSignal(link: { state: string }): boolean {
  return link.state === "pending";
}

/**
 * Whether the vessel's link report has not yet reached this command centre.
 * Every widget that draws the awaiting notice decides when with this and
 * nothing else, so the rule is read off one channel everywhere.
 */
export function useAwaitingFirstSignal(): boolean {
  return isAwaitingFirstSignal(useTelemetry("comms.link"));
}
