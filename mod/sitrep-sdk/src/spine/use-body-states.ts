import { useCallback } from "react";
import type {
  BodyStatesReply,
  BodyStatesRequest,
} from "../__generated__/contract";
import { useCommand } from "./use-command";

/** The command the engine registers for this. Not an Uplink's. */
export const BODY_STATES_COMMAND = "system.bodies.statesAt";

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
   * centre, are both things a caller renders rather than catches. What DOES
   * reject is a dispatch that never completed, because a message that never
   * left the browser is a network fact and not an answer about the solar
   * system.
   */
  solve: (request: BodyStatesRequest) => Promise<BodyStatesReply>;
}

/**
 * The client half of `system.bodies.statesAt`.
 *
 * Plainly typed in both directions: `TelemetryClient.dispatch` dehydrates args
 * and `handleCommandResponse` wraps the reply, so the generated types are true
 * at runtime and no wire-term lifting is needed here.
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
