import { useCallback, useState } from "react";
import type {
  LastKnownPathReply,
  LastKnownPathRequest,
} from "../__generated__/contract";
import { useCommand } from "./use-command";

/**
 * The id of the command that returns where the active craft goes from the state
 * the asking command centre last heard. Useful for dispatching that query by name.
 * It belongs to the engine and not to an Uplink.
 *
 * @category Orbits and trajectories
 */
export const LAST_KNOWN_PATH_COMMAND = "vessel.trajectory.fromLastKnown";

/**
 * What {@link useLastKnownPath} returns.
 *
 * @category Orbits and trajectories
 */
export interface LastKnownPathQuery {
  /**
   * Asks for the path. Call it on an event or a timer, never on render: it crosses
   * to the game and back, and a provider that integrates does real work to answer.
   */
  solve: (request: LastKnownPathRequest) => Promise<void>;
  /** The latest reply, or `null` before one has arrived. */
  reply: LastKnownPathReply | null;
  /** True while an ask is outstanding. */
  pending: boolean;
}

/**
 * The path the active craft follows from the state this command centre last heard,
 * from the elected propagation provider. Useful for drawing where a craft is going
 * when the operator's news of it is old. A refusal arrives as a reply to show the
 * operator, and a request that never reached the game arrives as one too, saying
 * so.
 *
 * @category Orbits and trajectories
 */
export function useLastKnownPath(): LastKnownPathQuery {
  // A question and not a command to a craft, and the caller draws the reply, so it stays off the panel's delay rail.
  // A query no kit input draws, so it is sent without one.
  const { dangerouslySendWithoutInput: send } = useCommand(
    LAST_KNOWN_PATH_COMMAND,
    { rail: false },
  );
  const [reply, setReply] = useState<LastKnownPathReply | null>(null);
  const [pending, setPending] = useState(false);

  // Keyed on `send`, which `useCommand` memoises, and not on the handle, which is a fresh object each render, so an effect keyed on `solve` would loop.
  const solve = useCallback(
    async (request: LastKnownPathRequest) => {
      setPending(true);
      try {
        setReply(await send(request));
      } catch (error) {
        setReply({
          solved: false,
          refusal:
            error instanceof Error
              ? `The request did not reach the game: ${error.message}`
              : "The request did not reach the game.",
        } as LastKnownPathReply);
      } finally {
        setPending(false);
      }
    },
    [send],
  );

  return { solve, reply, pending };
}
