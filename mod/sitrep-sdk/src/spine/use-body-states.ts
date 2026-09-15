import { useCallback } from "react";
import type {
  BodyStatesReply,
  BodyStatesRequest,
} from "../__generated__/contract";
import type { UseCommandResult } from "../api/types";
import type { WireOf } from "../wrap-units";
import { wrapTypePayload } from "../wrap-units";
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
  solve: (request: WireOf<BodyStatesRequest>) => Promise<BodyStatesReply>;

  /**
   * The dispatch handle, to hand to `usePanelDelay(handle)` in the widget body.
   *
   * Exposed rather than consumed here because `usePanelDelay` lives in
   * `ui-kit`, which sits ABOVE the spine and which the spine therefore cannot
   * import. `useCommand` asserts in dev that every dispatching handle reaches
   * the rail and offers no opt-out, so a widget that calls `solve` without
   * passing this on will throw and say so.
   */
  handle: UseCommandResult<WireOf<BodyStatesRequest>, WireOf<BodyStatesReply>>;
}

/**
 * The client half of `system.bodies.statesAt`.
 *
 * Both directions are stated in wire terms and only the reply is lifted out of
 * them, because a quantity crosses as a plain number each way and only one
 * side gets hydrated for free. Going OUT, a `Value` serialises as
 * `{magnitude, unit}` and would reach a host binding a `double`, so the
 * request is `WireOf<BodyStatesRequest>` and the untyped `useCommand` overload
 * is selected deliberately to say so. Coming BACK, nothing hydrates a command
 * reply the way the channel decode hydrates a payload, so this does it here:
 * the generated type promises `x: Value<"m">` and a caller reading `.magnitude`
 * off a bare number would get `undefined` rather than a type error.
 */
export function useBodyStates(): BodyStatesQuery {
  const command = useCommand<
    WireOf<BodyStatesRequest>,
    WireOf<BodyStatesReply>
  >(BODY_STATES_COMMAND);

  const solve = useCallback(
    async (request: WireOf<BodyStatesRequest>): Promise<BodyStatesReply> => {
      const wire = await command.send(request);
      return wrapTypePayload<BodyStatesReply>("BodyStatesReply", wire);
    },
    [command],
  );

  return { solve, handle: command };
}
