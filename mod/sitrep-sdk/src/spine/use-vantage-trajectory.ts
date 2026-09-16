import { useCallback, useState } from "react";
import type {
  VantagePlanReply,
  VantagePlanRequest,
} from "../__generated__/contract";
import type { UseCommandResult } from "../api/types";
import { useCommand } from "./use-command";

/** The command the engine registers for this. Not an Uplink's. */
export const VANTAGE_TRAJECTORY_COMMAND = "vessel.trajectory.forVantage";

export interface VantageTrajectory {
  /**
   * Ask where the craft goes, from THIS command centre's point of view.
   *
   * Explicit rather than fired on render, deliberately. A trajectory solve reads
   * an archive and integrates; a hook that ran one every time a component
   * re-rendered would do that at animation rate, and nothing in the call site
   * would say so.
   */
  solve: (request: VantagePlanRequest) => Promise<void>;

  /** The most recent answer, or null before one has been asked for. */
  reply: VantagePlanReply | null;

  /** True while a solve is outstanding. */
  pending: boolean;

  /**
   * The dispatch handle, to hand to `usePanelDelay(handle)` in the widget body.
   *
   * Exposed rather than consumed here because `usePanelDelay` lives in
   * `ui-kit`, which sits ABOVE the spine and which the spine therefore cannot
   * import. `useCommand` asserts in dev that every dispatching handle reaches
   * the rail and offers no opt-out, so until this was exposed, pressing a
   * control wired to `solve` threw in every build but production: there was no
   * handle to pass on, and the only widget calling it never dispatched under
   * test. Same shape as `useBodyStates`, for the same reason.
   */
  handle: UseCommandResult<VantagePlanRequest, VantagePlanReply>;
}

/**
 * The client half of `vessel.trajectory.forVantage`.
 *
 * <p>There is no vantage argument, and that is the point. The answer depends on
 * which command centre is asking, and it is resolved from the connection where
 * the command enters. A client able to name its own vantage could name somebody
 * else's and be shown what they can see.</p>
 *
 * <p>A refusal is not an error and does not throw. "Nothing has reached this
 * vantage yet" is an ordinary state of a distant mission, and callers render it
 * rather than catching it.</p>
 */
/**
 * A dispatch that never completed, as a refusal a caller can render.
 *
 * <p>Separate and exported because the distinction matters and is otherwise
 * untestable without mocking the transport, which this codebase does not do. A
 * message that never left is NOT "this vantage cannot see the craft": one is a
 * network fact and the other a mission fact, and a widget that showed the second
 * for the first would have an operator believe something about their spacecraft
 * that is untrue.</p>
 */
export function refusalFromError(error: unknown): VantagePlanReply {
  return {
    solved: false,
    refusal:
      error instanceof Error
        ? `The request did not reach the game: ${error.message}`
        : "The request did not reach the game.",
  } as VantagePlanReply;
}

export function useVantageTrajectory(): VantageTrajectory {
  const command = useCommand(VANTAGE_TRAJECTORY_COMMAND);
  const [reply, setReply] = useState<VantagePlanReply | null>(null);
  const [pending, setPending] = useState(false);

  // Keyed on `send`, which `useCommand` memoises, and NOT on the handle, which
  // is a fresh object on every render because it carries the command's live
  // status. Keyed on the handle, `solve` was a new function every render, so an
  // effect depending on it re-ran forever: one dispatch, a `setPending`, a
  // render, a new `solve`, the same effect again.
  const { send } = command;
  const solve = useCallback(
    async (request: VantagePlanRequest) => {
      setPending(true);
      try {
        const result = await send(request);
        setReply((result ?? null) as VantagePlanReply | null);
      } catch (error) {
        setReply(refusalFromError(error));
      } finally {
        setPending(false);
      }
    },
    [send],
  );

  return { solve, reply, pending, handle: command };
}
