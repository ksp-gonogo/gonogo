import { createContext, useContext } from "react";

/**
 * Says whether a mirrored game window belongs to this screen, given the id of
 * the press that opened it. Useful on the main screen, which receives the
 * windows that a station's press opened because the station's commands go out
 * through it, and must not show them as its own. Provided by the main screen's
 * peer host; a screen with no provider shows every window it receives, since
 * the host sends a station only the windows its own presses opened.
 */
export type GameWindowAudience = (pressId: string) => boolean;

const SHOWS_EVERY_WINDOW: GameWindowAudience = () => true;

export const GameWindowAudienceContext =
  createContext<GameWindowAudience>(SHOWS_EVERY_WINDOW);

/** The test that decides which received windows this screen draws. */
export function useGameWindowAudience(): GameWindowAudience {
  return useContext(GameWindowAudienceContext);
}
