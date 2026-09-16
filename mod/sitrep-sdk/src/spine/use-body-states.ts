import { useCallback } from "react";
import type {
  BodyStatesReply,
  BodyStatesRequest,
} from "../__generated__/contract";
import type { UseCommandResult } from "../api/types";
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

  /**
   * The dispatch handle, to hand to `usePanelDelay(handle)` in the widget body.
   *
   * Exposed rather than consumed here because `usePanelDelay` lives in
   * `ui-kit`, which sits ABOVE the spine and which the spine therefore cannot
   * import. `useCommand` asserts in dev that every dispatching handle reaches
   * the rail and offers no opt-out, so a widget that calls `solve` without
   * passing this on will throw and say so.
   */
  handle: UseCommandResult<BodyStatesRequest, BodyStatesReply>;
}

/**
 * The client half of `system.bodies.statesAt`.
 *
 * Plainly typed in both directions, which it was not until the client learned to
 * carry units across the command boundary. It used to state both sides in wire
 * terms and lift the reply back out by hand, because a `Value` arg serialised as
 * `{magnitude, unit}` into a host binding a `double` and nothing hydrated a reply
 * the way the channel decode hydrates a payload. `TelemetryClient.dispatch` now
 * dehydrates args and `handleCommandResponse` wraps the reply, so the generated
 * types are true at runtime and this hook is the ordinary shape again.
 */
export function useBodyStates(): BodyStatesQuery {
  const command = useCommand(BODY_STATES_COMMAND);

  // Keyed on `send`, which `useCommand` memoises, and NOT on the handle, which
  // is a fresh object on every render because it carries the command's live
  // status. See `useVantageTrajectory`, where the same shape looped an effect.
  const { send } = command;
  const solve = useCallback(
    (request: BodyStatesRequest): Promise<BodyStatesReply> => send(request),
    [send],
  );

  return { solve, handle: command };
}
