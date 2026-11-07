import { useCallback } from "react";
import type {
  BodyStatesReply,
  BodyStatesRequest,
} from "../__generated__/contract";
import { useCommand } from "./use-command";

/**
 * The id of the command the engine registers to return the position of every body
 * at an instant. Useful for dispatching that query by name. It belongs to the
 * engine and not to an Uplink.
 */
export const BODY_STATES_COMMAND = "trackingStation.bodies.statesAt";

export interface BodyStatesQuery {
  /**
   * Ask where a body is at each of these instants, from whichever propagation
   * provider the install elected.
   *
   * Explicit rather than fired on render, for the reason the trajectory query
   * gives: this crosses to the game and back, and a hook that ran one every
   * time a component re-rendered would do it at animation rate.
   *
   * A refusal is an ordinary answer and does not throw. An install with no
   * elected provider, and a body the provider cannot reach from the requested
   * centre, are both things a caller renders rather than catches. What does
   * reject is a dispatch that never completed, because a message that never
   * left the browser is a network fact and not an answer about the solar
   * system.
   */
  solve: (request: BodyStatesRequest) => Promise<BodyStatesReply>;
}

/**
 * Returns a function that asks the mod for the position of every body at one or
 * more instants, over `trackingStation.bodies.statesAt`. Useful for placing bodies on a
 * transfer plot at instants other than the one on screen. Used by the transfer
 * window widget.
 *
 * Arguments and reply are typed as generated, with no wire-term lifting:
 * `TelemetryClient.dispatch` dehydrates args and `handleCommandResponse` wraps the
 * reply.
 */
export function useBodyStates(): BodyStatesQuery {
  const command = useCommand(BODY_STATES_COMMAND);

  // Keyed on `send`, which `useCommand` memoises, and NOT on the handle, which is a fresh object on every render because it carries the command's live status, so a caller keying an effect on it loops.
  const { send } = command;
  const solve = useCallback(
    (request: BodyStatesRequest): Promise<BodyStatesReply> => send(request),
    [send],
  );

  return { solve };
}
